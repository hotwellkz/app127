import { collection, doc, runTransaction, serverTimestamp, query, where, getDocs, writeBatch, getDoc } from 'firebase/firestore';
import { db } from './config';
import { CategoryCardType } from '../../types';
import { formatAmount, parseAmount } from './categories';

export const transferFunds = async (
  sourceCategory: CategoryCardType,
  targetCategory: CategoryCardType,
  amount: number,
  description: string,
  photos: Array<{
    name: string;
    url: string;
    type: string;
    size: number;
    uploadedAt: Date;
    path: string;
  }> = [],
  isSalary?: boolean
): Promise<void> => {
  if (!amount || amount <= 0) {
    throw new Error('Сумма перевода должна быть больше нуля');
  }

  if (!description.trim()) {
    throw new Error('Необходимо указать комментарий к переводу');
  }

  try {
    await runTransaction(db, async (transaction) => {
      const sourceRef = doc(db, 'categories', sourceCategory.id);
      const targetRef = doc(db, 'categories', targetCategory.id);
      
      const sourceDoc = await transaction.get(sourceRef);
      const targetDoc = await transaction.get(targetRef);

      if (!sourceDoc.exists()) {
        throw new Error('Категория отправителя не найдена');
      }

      if (!targetDoc.exists()) {
        throw new Error('Категория получателя не найдена');
      }

      const sourceBalance = parseAmount(sourceDoc.data().amount);
      const targetBalance = parseAmount(targetDoc.data().amount);

      // Создаем ID для транзакции заранее
      const withdrawalId = doc(collection(db, 'transactions')).id;
      const depositId = doc(collection(db, 'transactions')).id;

      const timestamp = serverTimestamp();
      
      const transactionData: any = {
        categoryId: sourceCategory.id,
        fromUser: sourceCategory.title,
        toUser: targetCategory.title,
        amount: -amount,
        description,
        type: 'expense',
        date: timestamp,
        relatedTransactionId: withdrawalId,
        photos: photos
      };
      
      // Добавляем поле isSalary только если оно определено
      if (isSalary !== undefined) {
        transactionData.isSalary = isSalary;
      }
      
      transaction.set(doc(db, 'transactions', withdrawalId), transactionData);

      const depositData = {
        categoryId: targetCategory.id,
        fromUser: sourceCategory.title,
        toUser: targetCategory.title,
        amount: amount,
        description,
        type: 'income',
        date: timestamp,
        relatedTransactionId: withdrawalId,
        photos: photos
      };
      
      // Добавляем поле isSalary только если оно определено
      if (isSalary !== undefined) {
        depositData.isSalary = isSalary;
      }
      
      transaction.set(doc(db, 'transactions', depositId), depositData);

      transaction.update(sourceRef, {
        amount: formatAmount(sourceBalance - amount),
        updatedAt: timestamp
      });

      transaction.update(targetRef, {
        amount: formatAmount(targetBalance + amount),
        updatedAt: timestamp
      });
    });
  } catch (error) {
    console.error('Error transferring funds:', error);
    throw error;
  }
};
import { recalculateCategoryBalance } from './categories';

export const deleteTransaction = async (transactionId: string): Promise<void> => {
  if (!transactionId) {
    throw new Error('Transaction ID is required');
  }

  try {
    const batch = writeBatch(db);
    const transactionRef = doc(db, 'transactions', transactionId);
    const transactionSnap = await getDoc(transactionRef);

    if (!transactionSnap.exists()) {
      throw new Error('Transaction not found');
    }

    const transactionData = transactionSnap.data();
    const relatedTransactionId = transactionData.relatedTransactionId;
    const isWarehouseOperation = transactionData.isWarehouseOperation;
    const timestamp = serverTimestamp();

    batch.delete(transactionRef);

    // Если это складская операция, находим и удаляем документ склада
    if (isWarehouseOperation) {
      const warehouseDocsQuery = query(
        collection(db, 'warehouseDocuments'),
        where('relatedTransactionId', '==', transactionId)
      );
      
      const warehouseDocs = await getDocs(warehouseDocsQuery);
      
      for (const doc of warehouseDocs.docs) {
        const warehouseDoc = doc.data();
        
        // Возвращаем товары на склад
        for (const item of warehouseDoc.items) {
          const productRef = doc(db, 'products', item.product.id);
          const productSnap = await getDoc(productRef);
          
          if (productSnap.exists()) {
            const productData = productSnap.data();
            const currentQuantity = productData.quantity || 0;
            
            // Для расходной операции возвращаем товар на склад
            if (warehouseDoc.type === 'expense') {
              batch.update(productRef, {
                quantity: currentQuantity + item.quantity,
                updatedAt: serverTimestamp()
              });
            }
            // Для приходной операции уменьшаем количество
            else if (warehouseDoc.type === 'income') {
              batch.update(productRef, {
                quantity: Math.max(0, currentQuantity - item.quantity),
                updatedAt: serverTimestamp()
              });
            }
            // Удаляем историю операций для этого товара
            const productMovementsQuery = query(
              collection(db, 'productMovements'),
              where('productId', '==', item.product.id),
              where('date', '==', transactionData.date)
            );
            
            const movementsSnapshot = await getDocs(productMovementsQuery);
            movementsSnapshot.docs.forEach(doc => {
              batch.delete(doc.ref);
            });
          }
        }
        
        // Удаляем документ склада
        batch.delete(doc.ref);
      }
    }
    // Find and handle the related transaction
    let relatedTransactionData;
    if (relatedTransactionId) {
      const relatedTransactionsQuery = query(
        collection(db, 'transactions'),
        where('relatedTransactionId', '==', relatedTransactionId)
      );

      const relatedTransactionsSnapshot = await getDocs(relatedTransactionsQuery);
      relatedTransactionsSnapshot.docs.forEach(doc => {
        if (doc.id !== transactionId) {
          relatedTransactionData = doc.data();
          batch.delete(doc.ref);
        }
      });
    }

    // Commit batch first to delete transactions

    await batch.commit();

    // Then recalculate balances for affected categories
    await recalculateCategoryBalance(transactionData.categoryId);
    if (relatedTransactionData?.categoryId) {
      await recalculateCategoryBalance(relatedTransactionData.categoryId);
    }

  } catch (error) {
    console.error('Error deleting transaction:', error);
    throw new Error('Failed to delete transaction');
  }
};
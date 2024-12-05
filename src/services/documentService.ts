import { collection, query, where, orderBy, limit, getDocs, runTransaction } from 'firebase/firestore';
import { db } from '../lib/firebase';

const DOCUMENT_NUMBER_KEY = 'current_document_number';

export const getNextDocumentNumber = async (type: 'income' | 'expense'): Promise<string> => {
  try {
    const savedNumber = localStorage.getItem(`${DOCUMENT_NUMBER_KEY}_${type}`);
    if (savedNumber && await validateDocumentNumber(type, savedNumber)) {
      return savedNumber;
    }

    return await runTransaction(db, async (transaction) => {
      const q = query(
        collection(db, 'warehouseDocuments'),
        where('type', '==', type),
        orderBy('documentNumber', 'desc'),
        limit(1)
      );

      const snapshot = await getDocs(q);
      let nextNumber = 1;

      if (!snapshot.empty) {
        const lastDoc = snapshot.docs[0];
        const lastNumber = parseInt(lastDoc.data().documentNumber, 10);
        if (!isNaN(lastNumber)) {
          nextNumber = lastNumber + 1;
        }
      }

      const formattedNumber = String(nextNumber).padStart(6, '0');
      // Проверяем, не был ли этот номер уже использован
      if (await validateDocumentNumber(type, formattedNumber)) {
      localStorage.setItem(`${DOCUMENT_NUMBER_KEY}_${type}`, formattedNumber);
      return formattedNumber;
      } else {
        // Если номер уже существует, пробуем следующий
        return getNextDocumentNumber(type);
      }
    });

  } catch (error) {
    console.error('Error generating document number:', error);
    throw error;
  }
};

export const clearSavedDocumentNumber = (type: 'income' | 'expense') => {
  localStorage.removeItem(`${DOCUMENT_NUMBER_KEY}_${type}`);
};

export const validateDocumentNumber = async (type: string, number: string): Promise<boolean> => {
  try {
    const q = query(
      collection(db, 'warehouseDocuments'),
      where('type', '==', type),
      where('documentNumber', '==', number)
    );
    
    const snapshot = await getDocs(q);
    return snapshot.empty;
  } catch (error) {
    console.error('Error validating document number:', error);
    return false;
  }
};
import { Document, Packer, Paragraph, TextRun, AlignmentType } from 'docx';
import { saveAs } from 'file-saver';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import { collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from '../lib/firebase';

// Константы
const DOCUMENT_NUMBER_KEY = 'current_document_number';

// Функции для работы с номерами документов
export const getNextDocumentNumber = async (type: 'income' | 'expense'): Promise<string> => {
  try {
    const savedNumber = localStorage.getItem(`${DOCUMENT_NUMBER_KEY}_${type}`);
    if (savedNumber && await validateDocumentNumber(type, savedNumber)) {
      return savedNumber;
    }

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
    
    if (await validateDocumentNumber(type, formattedNumber)) {
      localStorage.setItem(`${DOCUMENT_NUMBER_KEY}_${type}`, formattedNumber);
      return formattedNumber;
    }
    
    return getNextDocumentNumber(type);
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

// Функции для работы с документами
export const generatePDFFromElement = async (elementId: string, fileName: string = 'document.pdf') => {
  try {
    const element = document.getElementById(elementId);
    if (!element) throw new Error('Element not found');

    const canvas = await html2canvas(element, {
      scale: 2,
      useCORS: true,
      logging: false
    });

    const imgWidth = 210; // A4 width in mm
    const pageHeight = 297; // A4 height in mm
    const imgHeight = (canvas.height * imgWidth) / canvas.width;
    let heightLeft = imgHeight;
    let position = 0;

    const pdf = new jsPDF('p', 'mm', 'a4');
    let firstPage = true;

    while (heightLeft >= 0) {
      if (!firstPage) {
        pdf.addPage();
      }
      
      pdf.addImage(
        canvas.toDataURL('image/jpeg', 1.0),
        'JPEG',
        0,
        position,
        imgWidth,
        imgHeight
      );
      
      heightLeft -= pageHeight;
      position -= pageHeight;
      firstPage = false;
    }

    pdf.save(fileName);
    return true;
  } catch (error) {
    console.error('Error generating PDF:', error);
    return false;
  }
};

// Функция для генерации DOCX
export const generateDOCX = async (contractData: any, fileName: string = 'document.docx') => {
  try {
    const doc = new Document({
      sections: [{
        properties: {},
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({
                text: `Договор подряда №${contractData.contractNumber}`,
                bold: true,
                size: 28
              })
            ]
          }),
          // ... остальные параграфы
        ]
      }]
    });

    const buffer = await Packer.toBlob(doc);
    saveAs(buffer, fileName);
    return true;
  } catch (error) {
    console.error('Error generating DOCX:', error);
    return false;
  }
};
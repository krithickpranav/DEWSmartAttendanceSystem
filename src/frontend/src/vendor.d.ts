declare module "idb" {
  export interface IDBPDatabase {
    get(storeName: string, key: IDBValidKey): Promise<any>;
    getAll(storeName: string): Promise<any[]>;
    put(storeName: string, value: any): Promise<IDBValidKey>;
    delete(storeName: string, key: IDBValidKey): Promise<void>;
    transaction(
      storeNames: string | string[],
      mode?: IDBTransactionMode,
    ): IDBPTransaction;
    objectStoreNames: DOMStringList;
    createObjectStore(
      name: string,
      options?: IDBObjectStoreParameters,
    ): IDBPObjectStore;
  }
  export interface IDBPTransaction {
    store: IDBPObjectStore;
  }
  export interface IDBPObjectStore {
    index(name: string): IDBPIndex;
    createIndex(
      name: string,
      keyPath: string | string[],
      options?: IDBIndexParameters,
    ): IDBPIndex;
  }
  export interface IDBPIndex {
    getAll(query?: IDBValidKey | IDBKeyRange): Promise<any[]>;
  }
  export function openDB(
    name: string,
    version: number,
    callbacks?: {
      upgrade?: (
        db: IDBPDatabase,
        oldVersion: number,
        newVersion: number | null,
        tx: any,
      ) => void;
      blocked?: () => void;
      blocking?: () => void;
      terminated?: () => void;
    },
  ): Promise<IDBPDatabase>;
}

declare module "jspdf" {
  export class jsPDF {
    constructor(options?: any);
    setFillColor(r: number, g: number, b: number): void;
    rect(x: number, y: number, w: number, h: number, style?: string): void;
    roundedRect(
      x: number,
      y: number,
      w: number,
      h: number,
      rx: number,
      ry: number,
      style?: string,
    ): void;
    setTextColor(r: number, g: number, b: number): void;
    setFontSize(size: number): void;
    setFont(fontName: string, fontStyle?: string): void;
    text(text: string | string[], x: number, y: number, options?: any): void;
    save(filename: string): void;
    internal: { pageSize: { height: number; width: number } };
  }
}

declare module "jspdf-autotable" {
  import type { jsPDF } from "jspdf";
  export default function autoTable(doc: jsPDF, options: any): void;
}

declare module "@vladmandic/face-api" {
  export const nets: any;
  export const detectSingleFace: any;
  export const SsdMobilenetv1Options: any;
  export const FaceLandmark68Net: any;
  export const FaceRecognitionNet: any;
  export const SsdMobilenetv1: any;
  export const LabeledFaceDescriptors: any;
  export const FaceMatcher: any;
  export function euclideanDistance(a: Float32Array, b: Float32Array): number;
  export const env: any;
}

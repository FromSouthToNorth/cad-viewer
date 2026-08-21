/**
 * Registers the native DXF converter with its parser worker URL.
 * The converter tokenizes DXF in a Web Worker and builds the database on the
 * main thread; without a reachable worker bundle it falls back to main-thread
 * parsing, so registration stays safe in every environment.
 */
import {
  AcDbDatabaseConverterManager,
  AcDbFileType,
  AcDbNativeDxfConverter
} from '@mlightcad/data-model'

export function registerNativeDxfConverter(parserWorkerUrl: string): void {
  const converter = new AcDbNativeDxfConverter({
    convertByEntityType: false,
    useWorker: true,
    parserWorkerUrl
  })
  AcDbDatabaseConverterManager.instance.register(AcDbFileType.DXF, converter)
}

/**
 * Minimal embedded drawing template used by {@link AcApDocManager.newDocument}.
 *
 * Creating a new document used to download `templates/acadiso.dxf` from the
 * configured base URL (a CDN), which put a network fetch and the full
 * open-file progress UI on every app entry even though the user never opened
 * a drawing. This minimal ASCII DXF keeps the same AC1032 / ANSI_936 header
 * as the CDN template; layer 0 is declared explicitly and everything else
 * (linetypes, text/dim styles, viewport, layouts, app ids) is filled in by
 * `AcDbDatabase.ensureDatabaseDefaults()` right after the read, so the
 * resulting document is a valid empty drawing ready for commands.
 */

/** File name used for the embedded template; the extension selects the DXF reader. */
export const DEFAULT_NEW_DRAWING_TEMPLATE_NAME = 'acadiso.dxf'

const DEFAULT_NEW_DRAWING_TEMPLATE_LINES = [
  '0', 'SECTION',
  '2', 'HEADER',
  '9', '$ACADVER',
  '1', 'AC1032',
  '9', '$DWGCODEPAGE',
  '3', 'ANSI_936',
  '0', 'ENDSEC',
  '0', 'SECTION',
  '2', 'TABLES',
  '0', 'TABLE',
  '2', 'LAYER',
  '0', 'LAYER',
  '2', '0',
  '70', '0',
  '62', '7',
  '6', 'Continuous',
  '0', 'ENDTAB',
  '0', 'ENDSEC',
  '0', 'SECTION',
  '2', 'ENTITIES',
  '0', 'ENDSEC',
  '0', 'EOF'
]

/** Encodes the embedded template as DXF bytes for {@link AcApDocManager.newDocument}. */
export function acapNewDrawingTemplateContent(): ArrayBuffer {
  const bytes = new TextEncoder().encode(
    DEFAULT_NEW_DRAWING_TEMPLATE_LINES.join('\r\n') + '\r\n'
  )
  return bytes.buffer as ArrayBuffer
}

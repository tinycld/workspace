/**
 * Side-effect module: importing this file registers the built-in preview viewers
 * (image, PDF, video, audio, code, generic) with the registry. Imported once
 * during app boot from core's Providers so every consumer sees the same defaults.
 *
 * Packages can register additional viewers (or override these) by calling
 * registerPreview() at module load time.
 */

import { AudioPreview } from './previews/AudioPreview'
import { CodePreview } from './previews/CodePreview'
import { GenericPreview } from './previews/GenericPreview'
import { ImagePreview } from './previews/ImagePreview'
import { PdfPreview } from './previews/PdfPreview'
import { VideoPreview } from './previews/VideoPreview'
import { registerPreview } from './registry'

registerPreview('image/*', { preview: ImagePreview })
registerPreview('application/pdf', { preview: PdfPreview })
registerPreview('video/*', { preview: VideoPreview })
registerPreview('audio/*', { preview: AudioPreview })
registerPreview('text/javascript', { preview: CodePreview })
registerPreview('application/json', { preview: CodePreview })
registerPreview('text/html', { preview: CodePreview })
registerPreview('text/css', { preview: CodePreview })
registerPreview('text/plain', { preview: CodePreview })
registerPreview('text/csv', { preview: CodePreview })
registerPreview('text/xml', { preview: CodePreview })
registerPreview('application/xml', { preview: CodePreview })
registerPreview('*', { preview: GenericPreview })

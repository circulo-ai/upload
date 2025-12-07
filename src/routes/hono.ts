import { Hono, type Context, type Env, type MiddlewareHandler } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { FileRouteHandler, type FileHandlerConfig } from './handler';
import { getContentType } from '../utils/validation';

// Re-export specific config type
export type { FileHandlerConfig } from './handler';

export interface RouteConfig<E extends Env> {
    /** Enable this route (default: true) */
    enabled?: boolean;
    /** Middleware to apply before this route handler */
    middleware?: MiddlewareHandler<E>[];
}

export interface HonoFileRoutesOptions<E extends Env = Env> {
    /**
     * Callback to extract metadata from the request context.
     * This metadata will be passed to the storage manager and saved with files.
     * Use this to attach User ID, Tenant ID, etc.
     */
    getUploadMetadata?: (c: Context<E>) => Promise<Record<string, any>> | Record<string, any>;

    /** Configure specific routes */
    routes?: {
        delete?: RouteConfig<E>;
        download?: RouteConfig<E>;
        presigned?: RouteConfig<E>;
        presignedBatch?: RouteConfig<E>;
        multipart?: RouteConfig<E>;
        upload?: RouteConfig<E>;
        serve?: RouteConfig<E>;
    };
}

export function createHonoFileRoutes<E extends Env = Env>(config: FileHandlerConfig, options: HonoFileRoutesOptions<E> = {}) {
    const handler = new FileRouteHandler(config);
    const router = new Hono<E>();

    const getMetadata = async (c: Context<E>) => {
        if (options.getUploadMetadata) {
            return await options.getUploadMetadata(c);
        }
        return {};
    };

    const isEnabled = (key: keyof NonNullable<typeof options.routes>) => {
        return options.routes?.[key]?.enabled !== false;
    };

    const getMiddleware = (key: keyof NonNullable<typeof options.routes>) => {
        return options.routes?.[key]?.middleware || [];
    };

    // --- Routes ---

    // DELETE
    if (isEnabled('delete')) {
        router.post('/delete', ...getMiddleware('delete'), async (c) => {
            try {
                const { key, context } = await c.req.json();
                const result = await handler.handleDelete(key, context);
                return c.json(result);
            } catch (error) {
                return c.json({ error: error instanceof Error ? error.message : 'Delete failed' }, 500);
            }
        });
    }

    // DOWNLOAD
    if (isEnabled('download')) {
        const downloadSchema = z.object({
            key: z.string(),
            name: z.string().optional(),
            context: z.string().optional(),
        });

        router.post('/download', ...getMiddleware('download'), zValidator('json', downloadSchema), async (c) => {
            try {
                const { key, name, context } = c.req.valid('json' as any);
                const result = await handler.handleDownload(key, name, context);
                return c.json(result);
            } catch (error) {
                return c.json({ error: error instanceof Error ? error.message : 'Download failed' }, 500);
            }
        });
    }

    // PRESIGNED SINGLE
    if (isEnabled('presigned')) {
        const presignedSchema = z.object({
            fileName: z.string().min(1),
            contentType: z.string().min(1),
            fileSize: z.number().positive(),
        });

        router.post('/presigned', ...getMiddleware('presigned'), zValidator('json', presignedSchema), async (c) => {
            try {
                const metadata = await getMetadata(c);
                const { fileName, contentType, fileSize } = c.req.valid('json' as any);
                const context = c.req.query('type') || c.req.query('context');

                const result = await handler.handlePresigned({ fileName, contentType, fileSize, context }, metadata);
                return c.json(result);
            } catch (error) {
                if (error instanceof Error && error.message === 'Unauthorized') return c.json({ error: 'Unauthorized' }, 401);
                return c.json({ error: error instanceof Error ? error.message : 'Failed to generate URL' }, 500);
            }
        });
    }

    // PRESIGNED BATCH
    if (isEnabled('presignedBatch')) {
        const batchFileSchema = z.object({
            fileName: z.string().min(1),
            contentType: z.string().min(1),
            fileSize: z.number().positive(),
        });
        const batchSchema = z.object({
            files: z.array(batchFileSchema).min(1).max(100),
        });

        router.post('/presigned/batch', ...getMiddleware('presignedBatch'), zValidator('json', batchSchema), async (c) => {
            try {
                const metadata = await getMetadata(c);
                const { files } = c.req.valid('json' as any);
                const type = c.req.query('type');

                const result = await handler.handleBatchPresigned({ files, type }, metadata);
                return c.json(result);
            } catch (error) {
                if (error instanceof Error && error.message === 'Unauthorized') return c.json({ error: 'Unauthorized' }, 401);
                return c.json({ error: error instanceof Error ? error.message : 'Failed to generate batch URLs' }, 500);
            }
        });
    }

    // MULTIPART
    if (isEnabled('multipart')) {
        router.post('/multipart', ...getMiddleware('multipart'), async (c) => {
            try {
                const metadata = await getMetadata(c);
                const action = c.req.query('action');
                const data = await c.req.json();

                if (!['initiate', 'get-part-urls', 'complete', 'abort'].includes(action as string)) {
                    return c.json({ error: 'Invalid action' }, 400);
                }

                const result = await handler.handleMultipart(action as any, data, metadata);
                return c.json(result);
            } catch (error) {
                if (error instanceof Error && error.message === 'Unauthorized') return c.json({ error: 'Unauthorized' }, 401);
                return c.json({ error: error instanceof Error ? error.message : 'Multipart operation failed' }, 500);
            }
        });
    }

    // UPLOAD
    if (isEnabled('upload')) {
        router.post('/upload', ...getMiddleware('upload'), async (c) => {
            try {
                const metadata = await getMetadata(c);
                const formData = await c.req.parseBody({ all: true });
                const context = formData['context'];

                const filesInput = formData['file'];
                const filesArray = Array.isArray(filesInput) ? filesInput : (filesInput ? [filesInput] : []);

                const validFiles = [];
                for (const f of filesArray) {
                    if (f && typeof f === 'object' && 'arrayBuffer' in f) {
                        // It's a File object (Blob)
                        validFiles.push({
                            buffer: Buffer.from(await (f as File).arrayBuffer()),
                            name: (f as File).name,
                            type: (f as File).type,
                            size: (f as File).size
                        });
                    }
                }

                const result = await handler.handleUpload(validFiles, typeof context === 'string' ? context : undefined, metadata);
                return c.json(result);
            } catch (error) {
                if (error instanceof Error && error.message === 'Unauthorized') return c.json({ error: 'Unauthorized' }, 401);
                return c.json({ error: error instanceof Error ? error.message : 'Upload failed' }, 500);
            }
        });
    }

    // SERVE
    if (isEnabled('serve')) {
        router.get('/serve/*', ...getMiddleware('serve'), async (c) => {
            try {
                const wildcard = c.req.param('*'); // files/serve/s3/... -> 's3/...'
                const key = decodeURIComponent(wildcard || '');
                const context = c.req.query('context');

                const { fileBuffer, filename } = await handler.handleServe(key, context);

                // Cast to string or provide default for Content-Type header compatibility
                const contentType = (getContentType(filename) || 'application/octet-stream') as string;

                return new Response(fileBuffer, {
                    status: 200,
                    headers: {
                        'Content-Type': contentType,
                        'Content-Disposition': 'inline; filename="' + filename + '"',
                        'Cache-Control': 'public, max-age=31536000',
                        'X-Content-Type-Options': 'nosniff',
                    },
                });
            } catch (error) {
                return c.json({ error: error instanceof Error ? error.message : 'File not found' }, 404);
            }
        });
    }

    return router;
}

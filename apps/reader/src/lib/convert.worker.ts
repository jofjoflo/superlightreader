import { encode } from '@jsquash/avif';

interface EncodeRequest {
	id: number;
	data: ArrayBuffer;
	width: number;
	height: number;
	quality: number;
	lossless: boolean;
}

interface EncodeResponse {
	id: number;
	output?: ArrayBuffer;
	error?: string;
}

self.onmessage = async ({ data }: MessageEvent<EncodeRequest>) => {
	const response: EncodeResponse = { id: data.id };
	try {
		const image = new ImageData(new Uint8ClampedArray(data.data), data.width, data.height);
		const output = await encode(image, { quality: data.quality, lossless: data.lossless });
		response.output = output;
		(self as unknown as { postMessage(message: EncodeResponse, transfer?: Transferable[]): void }).postMessage(response, [output]);
	} catch (error) {
		response.error = error instanceof Error ? error.message : 'AVIF-kodning misslyckades';
		(self as unknown as { postMessage(message: EncodeResponse): void }).postMessage(response);
	}
};


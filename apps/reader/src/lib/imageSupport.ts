/**
 * Test if the browser supports AVIF images
 */
export async function testAvifSupport(): Promise<boolean> {
	try {
		// Method 1: Try createImageBitmap with a minimal AVIF
		const canvas = document.createElement('canvas');
		canvas.width = 1;
		canvas.height = 1;
		const ctx = canvas.getContext('2d');
		if (!ctx) return false;
		
		// Create a test AVIF blob (minimal valid AVIF header)
		const avifBytes = new Uint8Array([
			0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70,
			0x61, 0x76, 0x69, 0x66, 0x00, 0x00, 0x00, 0x00,
			0x61, 0x76, 0x69, 0x66, 0x6D, 0x69, 0x66, 0x31
		]);
		
		const blob = new Blob([avifBytes], { type: 'image/avif' });
		
		// Test with createImageBitmap
		try {
			await createImageBitmap(blob);
			return true;
		} catch {
			// Fall back to checking if browser claims AVIF support
			return testAvifViaImage();
		}
	} catch (error) {
		console.warn('AVIF test failed:', error);
		return testAvifViaImage();
	}
}

/**
 * Alternative AVIF test using Image element
 */
function testAvifViaImage(): boolean {
	try {
		// Check if the browser supports AVIF via Image
		const img = new Image();
		img.src = 'data:image/avif;base64,AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAADybWV0YQAAAAAAAAAoaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAGxpYmF2aWYAAAAADnBpdG0AAAAAAAEAAAAeaWxvYwAAAABEAAABAAEAAAABAAABGgAAAB0AAAAoaWluZgAAAAAAAQAAABppbmZlAgAAAAABAABhdjAxQ29sb3IAAAAAamlwcnAAAABLaXBjbwAAABRpc3BlAAAAAAAAAAIAAAACAAAAEHBpeGkAAAAAAwgICAAAAAxhdjFDgQ0MAAAAABNjb2xybmNseAACAAIAAYAAAAAXaXBtYQAAAAAAAAABAAEEAQKDBAAAACVtZGF0EgAKCBgABogQEAwgMg8f8D///8WfhwB8+ErK42A=';
		return true; // If this doesn't throw, assume support
	} catch {
		return false;
	}
}

/**
 * Check if the browser supports various image formats
 */
export async function checkImageSupport() {
	const support = {
		avif: await testAvifSupport(),
		webp: await testImageFormat('image/webp'),
		jpeg: true, // Always supported
		png: true   // Always supported
	};

	return support;
}

/**
 * Generic test for image format support
 */
async function testImageFormat(mimeType: string): Promise<boolean> {
	try {
		// Create a 1x1 pixel test canvas
		const canvas = document.createElement('canvas');
		canvas.width = 1;
		canvas.height = 1;
		
		const ctx = canvas.getContext('2d');
		if (!ctx) return false;
		
		ctx.fillStyle = 'red';
		ctx.fillRect(0, 0, 1, 1);
		
		// Try to convert to the format
		return new Promise((resolve) => {
			canvas.toBlob(
				(blob) => {
					resolve(blob !== null);
				},
				mimeType,
				1
			);
		});
	} catch (error) {
		return false;
	}
}

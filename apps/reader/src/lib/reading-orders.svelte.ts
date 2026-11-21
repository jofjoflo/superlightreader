import { parseReadingOrderJson } from './reading-order.ts';
import type { ParseReadingOrderResult, ReadingOrder } from './reading-order.ts';

export const READING_ORDERS_STORAGE_KEY = 'slr.reading-orders';

function storage(): Storage | undefined {
	try {
		return typeof localStorage === 'undefined' ? undefined : localStorage;
	} catch {
		return undefined;
	}
}

export function loadReadingOrders(store: Storage | undefined = storage()): ReadingOrder[] {
	if (!store) return [];
	try {
		const raw = JSON.parse(store.getItem(READING_ORDERS_STORAGE_KEY) ?? '[]');
		if (!Array.isArray(raw)) return [];
		return raw.flatMap((value) => {
			const result = parseReadingOrderJson(value);
			return result.order ? [{ ...result.order, id: typeof value?.id === 'string' ? value.id : result.order.id, createdAt: typeof value?.createdAt === 'number' ? value.createdAt : result.order.createdAt }] : [];
		});
	} catch {
		return [];
	}
}

export function saveReadingOrders(orders: ReadingOrder[], store: Storage | undefined = storage()): boolean {
	if (!store) return false;
	try {
		store.setItem(READING_ORDERS_STORAGE_KEY, JSON.stringify(orders));
		return true;
	} catch {
		return false;
	}
}

class ReadingOrdersStore {
	items = $state.raw<ReadingOrder[]>([]);
	ready = $state(false);

	init() {
		if (!this.ready) {
			this.items = loadReadingOrders();
			this.ready = true;
		}
	}

	importJson(input: string | unknown): ParseReadingOrderResult {
		const result = parseReadingOrderJson(input);
		if (result.order) {
			this.items = [result.order, ...this.items.filter((x) => x.id !== result.order?.id)];
			result.saved = saveReadingOrders(this.items);
		}
		return result;
	}

	remove(id: string): boolean {
		const next = this.items.filter((x) => x.id !== id);
		if (!saveReadingOrders(next)) return false;
		this.items = next;
		return true;
	}
}

export const readingOrders = new ReadingOrdersStore();

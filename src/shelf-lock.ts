let token = '';
let owner = '';
let ready = false;
let locked = new Set<string>();
export const shelfHeaders = (): Record<string,string> => token ? { 'X-Shelf-Unlock': token } : {};
export const bookLocked = (id: string) => !!owner && (!ready || locked.has(id));
export function resetShelfOwner(user: string) { owner = user; token = ''; ready = !user; locked = new Set(); }
export function setShelfToken(value: string) { token = value; }
export function setLockedBooks(ids: string[]) { locked = new Set(ids); ready = true; }

export function invalidateShelf() { ready = false; }

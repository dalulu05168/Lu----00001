// Browser preview intentionally keeps sessions in memory only.
// Closing/reloading the page ends the preview session. Never persist tokens in localStorage.
const memory = new Map<string,string>();
export async function getItemAsync(key:string):Promise<string|null>{return memory.get(key)??null;}
export async function setItemAsync(key:string,value:string):Promise<void>{memory.set(key,value);}
export async function deleteItemAsync(key:string):Promise<void>{memory.delete(key);}

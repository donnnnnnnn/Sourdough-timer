import { StateStorage } from 'zustand/middleware';

// Web fallback: localStorage (SQLite wasm isn't available in web bundles)
const sqliteStorage: StateStorage = {
  getItem: (name) => localStorage.getItem(name),
  setItem: (name, value) => localStorage.setItem(name, value),
  removeItem: (name) => localStorage.removeItem(name),
};

export default sqliteStorage;

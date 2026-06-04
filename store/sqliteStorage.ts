import { StateStorage } from 'zustand/middleware';
import * as SQLite from 'expo-sqlite/kv-store';

// Native: synchronous SQLite C++ engine via expo-sqlite/kv-store
const sqliteStorage: StateStorage = {
  getItem: (name) => SQLite.getItemSync(name) ?? null,
  setItem: (name, value) => SQLite.setItemSync(name, value),
  removeItem: (name) => SQLite.removeItemSync(name),
};

export default sqliteStorage;

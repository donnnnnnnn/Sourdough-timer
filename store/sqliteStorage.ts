import { StateStorage } from 'zustand/middleware';
import { Storage } from 'expo-sqlite/kv-store';

// Native: synchronous SQLite C++ engine via expo-sqlite/kv-store
const sqliteStorage: StateStorage = {
  getItem: (name) => Storage.getItemSync(name),
  setItem: (name, value) => Storage.setItemSync(name, value),
  removeItem: (name) => { Storage.removeItemSync(name); },
};

export default sqliteStorage;

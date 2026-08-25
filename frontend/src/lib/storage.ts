import AsyncStorage from '@react-native-async-storage/async-storage';

const USER_ID_KEY = 'nutriscan_user_id';

export const storage = {
  async getUserId(): Promise<string | null> {
    return AsyncStorage.getItem(USER_ID_KEY);
  },
  async setUserId(id: string) {
    return AsyncStorage.setItem(USER_ID_KEY, id);
  },
  async clear() {
    return AsyncStorage.removeItem(USER_ID_KEY);
  },
};

import { APP_VARIANT, IS_DTU_MODE, probeDtuHealth } from './_firebase/firebase-app';

export { APP_VARIANT, IS_DTU_MODE };

export async function checkDtuConnection() {
  return probeDtuHealth();
}

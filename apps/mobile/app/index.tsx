import { Redirect, type Href } from 'expo-router';
import { peekBufferedInitialRoute } from '@/hooks/useDeepLinks';

export default function IndexRedirect() {
  const initialRoute = peekBufferedInitialRoute();
  if (initialRoute && !initialRoute.requiresAuthHydration) {
    return <Redirect href={initialRoute.href as Href} />;
  }
  return <Redirect href="/(tabs)/home" />;
}

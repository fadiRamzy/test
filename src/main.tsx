import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/500.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import '@fontsource/ibm-plex-sans-arabic/700.css';
import './styles/base.css';
import './styles/reference.css';
import './styles/reference-compat.css';
import { App } from './App';
import { AppProvider } from './state/store';
import { registerServiceWorker } from './serviceWorker';

// ضمان اتجاه RTL واللغة العربية على مستوى المستند
document.documentElement.lang = 'ar';
document.documentElement.dir = 'rtl';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </React.StrictMode>,
);

registerServiceWorker();

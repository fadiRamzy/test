import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource/cairo/400.css';
import '@fontsource/cairo/500.css';
import '@fontsource/cairo/600.css';
import '@fontsource/cairo/700.css';
import './styles/base.css';
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

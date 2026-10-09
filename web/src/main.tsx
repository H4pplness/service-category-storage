import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp, ConfigProvider } from 'antd';
import viVN from 'antd/locale/vi_VN';
import dayjs from 'dayjs';
import 'dayjs/locale/vi';
import App from './App';
import { AuthProvider } from './auth';
import './styles.css';

dayjs.locale('vi');

const qc = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 0 } },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <ConfigProvider
    locale={viVN}
    theme={{
      token: {
        colorPrimary: '#4f46e5',
        borderRadius: 8,
        fontFamily: "Inter, -apple-system, 'Segoe UI', Roboto, sans-serif",
        colorBgLayout: '#f4f6fb',
        colorBorderSecondary: '#eceef4',
      },
      components: {
        Menu: { itemBorderRadius: 8, itemSelectedBg: '#eef2ff', itemSelectedColor: '#4338ca', itemHeight: 40 },
        Card: { headerFontSize: 15 },
        Table: { headerBg: '#f8f9fc' },
      },
    }}
  >
    <AntApp>
      <QueryClientProvider client={qc}>
        <BrowserRouter>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </AntApp>
  </ConfigProvider>,
);

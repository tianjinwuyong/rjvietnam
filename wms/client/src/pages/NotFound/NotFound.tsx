import { Link } from 'react-router-dom';
import { useI18n } from '../../i18n';

const NotFound = () => {
  const { t } = useI18n();
  return (
    <div style={{ padding: 60, textAlign: 'center' }}>
      <h1 style={{ fontSize: 72, margin: 0, color: '#ccc' }}>404</h1>
      <p style={{ fontSize: 18, color: '#666', margin: '16px 0 24px' }}>{t('ui.页面不存在')}</p>
      <Link to="/" style={{ padding: '8px 24px', background: '#1677ff', color: '#fff', borderRadius: 6, textDecoration: 'none' }}>
        {t('ui.返回首页')}
      </Link>
    </div>
  );
};

export default NotFound;

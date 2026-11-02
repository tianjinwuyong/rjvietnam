import React from 'react';
import logoImg from '@client/src/assets/company-logo.png';
import { useI18n } from '../i18n';

interface CompanyLogoProps {
  size?: number;
  className?: string;
}

/**
 * 深圳市瑞晶实业有限公司 Logo
 * 使用真实公司 logo 图片
 */
const CompanyLogo: React.FC<CompanyLogoProps> = ({ size = 40, className = '' }) => {
  const { t } = useI18n();
  return (
    <img
      src={logoImg}
      alt={t('login.title')}
      width={size}
      height={size}
      style={{ width: size, height: size, objectFit: 'contain' }}
      className={className}
      draggable={false}
    />
  );
};

export default CompanyLogo;

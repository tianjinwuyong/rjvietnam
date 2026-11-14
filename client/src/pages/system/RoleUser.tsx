import React from 'react';
import { useI18n } from '@client/src/i18n';

const RoleUser: React.FC = () => {
  const { t } = useI18n();
  return (
    <div className="bg-card rounded-[12px] p-12 border border-border text-center">
      <h2 className="text-xl font-semibold text-foreground mb-2">{t('system.roleUser')}</h2>
      <p className="text-muted-foreground">{t('common.comingSoon')}</p>
    </div>
  );
};

export default RoleUser;

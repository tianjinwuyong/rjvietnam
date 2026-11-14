import React, { useEffect, useState } from 'react';
import { Card, CardContent } from '@client/src/components/ui/card';
import { ClipboardList, Clock } from 'lucide-react';
import { dashboard as dashboardApi } from '@client/src/api';
import type { PendingStats } from '@shared/api.interface';
import { logger } from '@client/src/utils/logger';
import { toast } from 'sonner';
import { useI18n } from '../../i18n';

const PendingCards: React.FC = () => {
  const { t } = useI18n();
  const [data, setData] = useState<PendingStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    dashboardApi
      .getPendingStats()
      .then((res) => setData(res))
      .catch((err) => {
        logger.error('Failed to load pending stats', err);
        toast.error(t('ui.待检统计加载失败'));
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Card>
        <CardContent className="pt-5">
          {loading ? (
            <div className="animate-pulse h-16 rounded-xl bg-muted" />
          ) : (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-3xl font-bold text-foreground">
                  {data?.pendingCount ?? 0}
                </p>
                <p className="text-sm text-muted-foreground mt-1">{t('ui.待检批数')}</p>
                <p
                  className={`text-xs mt-2 font-medium ${
                    data?.pendingCleared ? 'text-[#34C759]' : 'text-[#FF9500]'
                  }`}
                >
                  {data?.pendingCleared ? t('ui.已清零') : t('ui.有待检')}
                </p>
              </div>
              <div className="w-14 h-14 rounded-xl bg-orange-100 text-orange-500 flex items-center justify-center">
                <ClipboardList size={26} />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-5">
          {loading ? (
            <div className="animate-pulse h-16 rounded-xl bg-muted" />
          ) : (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-3xl font-bold text-foreground">
                  {data?.pendingOver24hCount ?? 0}
                </p>
                <p className="text-sm text-muted-foreground mt-1">{t('ui.待检超24h')}</p>
                <p
                  className={`text-xs mt-2 font-medium ${
                    data?.over24hCleared ? 'text-[#34C759]' : 'text-[#FF3B30]'
                  }`}
                >
                  {data?.over24hCleared ? t('ui.已清零') : t('ui.超期未检')}
                </p>
              </div>
              <div className="w-14 h-14 rounded-xl bg-red-100 text-red-500 flex items-center justify-center">
                <Clock size={26} />
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default PendingCards;

import React, { useState, useEffect } from 'react';
import { useI18n } from '@client/src/i18n';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@client/src/components/ui/dialog';
import { Button } from '@client/src/components/ui/button';
import { Badge } from '@client/src/components/ui/badge';
import { RadioGroup, RadioGroupItem } from '@client/src/components/ui/radio-group';
import { Label } from '@client/src/components/ui/label';
import { logger } from '@client/src/utils/logger';
import { getTemplateList, getLastUsedTemplate } from '@client/src/api/iqc';
import type { IqcTemplate } from '@shared/api.interface';
import { toast } from 'sonner';

interface TemplateSelectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  materialId: string;
  onSelect: (template: IqcTemplate) => void;
}

const TemplateSelectDialog: React.FC<TemplateSelectDialogProps> = ({
  open,
  onOpenChange,
  materialId,
  onSelect,
}) => {
  const { t } = useI18n();
  const [loading, setLoading] = useState(false);
  const [templates, setTemplates] = useState<IqcTemplate[]>([]);
  const [lastUsedId, setLastUsedId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string>('');

  useEffect(() => {
    if (!open || !materialId) {
      setTemplates([]);
      setLastUsedId(null);
      setSelectedId('');
      return;
    }
    const load = async () => {
      setLoading(true);
      try {
        const [templateResult, lastUsed] = await Promise.all([
          getTemplateList({ page: 1, pageSize: 100, status: 'active' }),
          getLastUsedTemplate(materialId).catch(() => null),
        ]);
        setTemplates(templateResult.items);
        if (lastUsed) {
          setLastUsedId(lastUsed.id);
          setSelectedId(lastUsed.id);
        } else if (templateResult.items.length > 0) {
          setSelectedId(templateResult.items[0].id);
        }
      } catch (error) {
        logger.error('load templates for selection failed', error);
        toast.error(t('message.loadFailed'));
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [open, materialId]);

  const handleConfirm = () => {
    const selected = templates.find((tpl: IqcTemplate) => tpl.id === selectedId);
    if (selected) {
      onSelect(selected);
      onOpenChange(false);
    }
  };

  const getSizeLabel = (tpl: IqcTemplate): string => {
    const rows = tpl.rowCount ?? 0;
    const cols = tpl.colCount ?? 0;
    return `${rows} ${t('iqc.templateRows')} × ${cols} ${t('iqc.templateCols')}`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[75vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{t('iqc.selectTemplate')}</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto -mx-6 px-6">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
              {t('common.loading')}
            </div>
          ) : templates.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
              {t('message.noData')}
            </div>
          ) : (
            <RadioGroup value={selectedId} onValueChange={setSelectedId} className="space-y-2">
              {templates.map((tpl: IqcTemplate) => {
                const isDefault = tpl.id === lastUsedId;
                return (
                  <div
                    key={tpl.id}
                    className={`flex items-start gap-3 p-3 rounded-md border transition-colors ${
                      selectedId === tpl.id
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:bg-muted/50'
                    }`}
                  >
                    <RadioGroupItem value={tpl.id} id={`tpl-${tpl.id}`} className="mt-1" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Label
                          htmlFor={`tpl-${tpl.id}`}
                          className={`text-sm cursor-pointer truncate ${
                            isDefault ? 'font-bold text-foreground' : 'font-medium text-foreground'
                          }`}
                        >
                          {tpl.templateName}
                        </Label>
                        {isDefault && (
                          <Badge variant="default" className="text-xs h-5 bg-orange-500 hover:bg-orange-500">
                            {t('iqc.defaultTemplate')}
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {getSizeLabel(tpl)}
                        {tpl.version && ` · ${t('iqc.templateVersion')}: ${tpl.version}`}
                      </div>
                    </div>
                  </div>
                );
              })}
            </RadioGroup>
          )}
        </div>

        <DialogFooter className="pt-4">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleConfirm} disabled={!selectedId || loading}>
            {t('common.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default TemplateSelectDialog;

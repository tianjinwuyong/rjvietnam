import React, { useState } from 'react';
import { useI18n } from '@client/src/i18n';
import { Input } from '@client/src/components/ui/input';
import { Button } from '@client/src/components/ui/button';
import { Checkbox } from '@client/src/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@client/src/components/ui/dialog';
import { logger } from '@client/src/utils/logger';
import { toast } from 'sonner';
import { createTemplate } from '@client/src/api/iqc';
import { SECTION_LIST, type SectionKey } from './IqcStandardLibraryDialog';
import type { IqcTemplate } from '@shared/api.interface';

interface TemplateCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (template: IqcTemplate) => void;
}

const TemplateCreateDialog: React.FC<TemplateCreateDialogProps> = ({
  open,
  onOpenChange,
  onCreated,
}) => {
  const { t } = useI18n();
  const [templateName, setTemplateName] = useState('');
  const [selected, setSelected] = useState<SectionKey[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const toggleSection = (key: SectionKey) => {
    setSelected(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key],
    );
  };

  const reset = () => {
    setTemplateName('');
    setSelected([]);
  };

  const handleSubmit = async () => {
    if (!templateName.trim()) {
      toast.error(t('iqc.templateName') + (t('message.requiredField') || '不能为空'));
      return;
    }
    if (selected.length === 0) {
      toast.warning(t('iqc.selectSectionsHint'));
      return;
    }
    setSubmitting(true);
    try {
      const created = await createTemplate({
        templateName: templateName.trim(),
        selectedSections: selected,
        copyFromStandard: true,
      });
      toast.success(t('message.saveSuccess'));
      reset();
      onOpenChange(false);
      onCreated(created);
    } catch (error) {
      logger.error('create template failed', error);
      toast.error(t('message.saveFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('iqc.newTemplate')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              {t('iqc.templateName')} <span className="text-destructive">*</span>
            </label>
            <Input
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              placeholder={t('iqc.templateName')}
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              {t('iqc.selectSections')}
            </label>
            <p className="text-xs text-muted-foreground mb-2">{t('iqc.selectSectionsHint')}</p>
            <div className="grid grid-cols-1 gap-2 border border-border rounded-md p-3">
              {SECTION_LIST.map(s => {
                const checked = selected.includes(s.key);
                return (
                  <label
                    key={s.key}
                    className="flex items-center gap-2 cursor-pointer hover:bg-muted/40 rounded px-1 py-1"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => toggleSection(s.key)}
                    />
                    <span className="text-sm text-foreground">{t(s.labelI18n)}</span>
                  </label>
                );
              })}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? t('common.saving') : t('common.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default TemplateCreateDialog;

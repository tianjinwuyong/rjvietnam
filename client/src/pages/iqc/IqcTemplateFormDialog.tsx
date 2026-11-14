import React, { useState } from 'react';
import { useI18n } from '@client/src/i18n';
import { Input } from '@client/src/components/ui/input';
import { Button } from '@client/src/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@client/src/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@client/src/components/ui/dialog';
import { logger } from '@client/src/utils/logger';
import { toast } from 'sonner';
import { createTemplate, updateTemplate } from '@client/src/api/iqc';
import type { IqcTemplate } from '@shared/api.interface';

interface TemplateFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingId: string | null;
  initialData: Partial<IqcTemplate>;
  onSaved: () => void;
}

const TemplateFormDialog: React.FC<TemplateFormDialogProps> = ({
  open,
  onOpenChange,
  editingId,
  initialData,
  onSaved,
}) => {
  const { t } = useI18n();
  const [formData, setFormData] = useState<Partial<IqcTemplate>>(initialData);
  const [submitting, setSubmitting] = useState(false);

  React.useEffect(() => {
    if (open) setFormData(initialData);
  }, [open, initialData]);

  const handleSave = async () => {
    if (!formData.templateName?.trim()) {
      toast.error(t('iqc.templateName') + t('message.requiredField'));
      return;
    }
    setSubmitting(true);
    try {
      if (editingId) {
        await updateTemplate(editingId, formData);
        toast.success(t('message.updateSuccess'));
      } else {
        await createTemplate(formData);
        toast.success(t('message.createSuccess'));
      }
      onOpenChange(false);
      onSaved();
    } catch (error) {
      logger.error('save template failed', error);
      toast.error(t('message.saveFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {editingId ? t('common.edit') : t('common.add')}{t('iqc.template')}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                {t('iqc.templateName')} <span className="text-destructive">*</span>
              </label>
              <Input
                value={formData.templateName || ''}
                onChange={(e) => setFormData(p => ({ ...p, templateName: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                {t('iqc.templateCode')}
              </label>
              <Input
                value={formData.templateCode || ''}
                onChange={(e) => setFormData(p => ({ ...p, templateCode: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                {t('iqc.templateVersion')}
              </label>
              <Input
                value={formData.version || ''}
                onChange={(e) => setFormData(p => ({ ...p, version: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                {t('common.status')}
              </label>
              <Select
                value={formData.status || 'active'}
                onValueChange={(v) => setFormData(p => ({ ...p, status: v }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">{t('common.active')}</SelectItem>
                  <SelectItem value="inactive">{t('common.inactive')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              {t('common.description')}
            </label>
            <Input
              value={formData.description || ''}
              onChange={(e) => setFormData(p => ({ ...p, description: e.target.value }))}
            />
          </div>
          <div className="border-t border-border pt-3">
            <h4 className="text-sm font-medium mb-3">{t('iqc.samplingPlan')}</h4>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-muted-foreground mb-1">{t('iqc.packagingAql')}</label>
                <Input
                  value={formData.packagingAql || ''}
                  onChange={(e) => setFormData(p => ({ ...p, packagingAql: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">{t('iqc.appearanceLevel')}</label>
                <Input
                  value={formData.appearanceLevel || ''}
                  onChange={(e) => setFormData(p => ({ ...p, appearanceLevel: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">{t('iqc.appearanceAql')}</label>
                <Input
                  value={formData.appearanceAql || ''}
                  onChange={(e) => setFormData(p => ({ ...p, appearanceAql: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">{t('iqc.dimensionLevel')}</label>
                <Input
                  value={formData.dimensionLevel || ''}
                  onChange={(e) => setFormData(p => ({ ...p, dimensionLevel: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">{t('iqc.dimensionAql')}</label>
                <Input
                  value={formData.dimensionAql || ''}
                  onChange={(e) => setFormData(p => ({ ...p, dimensionAql: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">{t('iqc.reliabilitySampleSize')}</label>
                <Input
                  type="number"
                  value={String(formData.reliabilitySampleSize ?? '')}
                  onChange={(e) => setFormData(p => ({ ...p, reliabilitySampleSize: e.target.value ? Number(e.target.value) : undefined }))}
                />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">{t('iqc.environmentalSampleSize')}</label>
                <Input
                  type="number"
                  value={String(formData.environmentalSampleSize ?? '')}
                  onChange={(e) => setFormData(p => ({ ...p, environmentalSampleSize: e.target.value ? Number(e.target.value) : undefined }))}
                />
              </div>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button onClick={handleSave} disabled={submitting}>
            {submitting ? t('common.saving') : t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default TemplateFormDialog;

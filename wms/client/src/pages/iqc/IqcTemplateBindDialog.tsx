import React, { useState, useEffect } from 'react';
import { useI18n } from '@client/src/i18n';
import { Input } from '@client/src/components/ui/input';
import { Button } from '@client/src/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@client/src/components/ui/dialog';
import { Search, Trash2 } from 'lucide-react';
import { logger } from '@client/src/utils/logger';
import { toast } from 'sonner';
import { getTemplateMaterials, bindTemplateMaterials } from '@client/src/api/iqc';
import { getMaterialList } from '@client/src/api/material';
import type { Material } from '@shared/api.interface';

interface BoundMaterial {
  id: string;
  materialCode: string;
  materialName: string;
}

interface TemplateBindDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templateId: string | null;
  onSaved: () => void;
}

const TemplateBindDialog: React.FC<TemplateBindDialogProps> = ({
  open,
  onOpenChange,
  templateId,
  onSaved,
}) => {
  const { t } = useI18n();
  const [boundMaterials, setBoundMaterials] = useState<BoundMaterial[]>([]);
  const [materialSearch, setMaterialSearch] = useState('');
  const [materialList, setMaterialList] = useState<Material[]>([]);
  const [materialLoading, setMaterialLoading] = useState(false);
  const [selectedMaterialIds, setSelectedMaterialIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !templateId) return;
    setMaterialSearch('');
    setMaterialList([]);
    setSelectedMaterialIds([]);
    const load = async () => {
      try {
        const bound = await getTemplateMaterials(templateId);
        setBoundMaterials(bound);
      } catch (error) {
        logger.error('get template materials failed', error);
        setBoundMaterials([]);
      }
    };
    load();
  }, [open, templateId]);

  const searchMaterials = async () => {
    setMaterialLoading(true);
    try {
      const result = await getMaterialList({
        page: 1,
        pageSize: 50,
        materialCode: materialSearch || undefined,
        materialName: materialSearch || undefined,
        status: 'active',
      });
      const boundIds = new Set(boundMaterials.map(m => m.id));
      setMaterialList(result.items.filter(m => !boundIds.has(m.id)));
    } catch (error) {
      logger.error('search materials failed', error);
    } finally {
      setMaterialLoading(false);
    }
  };

  const addSelectedMaterials = () => {
    if (selectedMaterialIds.length === 0) return;
    const toAdd = materialList.filter(m => selectedMaterialIds.includes(m.id));
    setBoundMaterials(prev => [
      ...prev,
      ...toAdd.map(m => ({ id: m.id, materialCode: m.materialCode, materialName: m.materialName })),
    ]);
    setMaterialList(prev => prev.filter(m => !selectedMaterialIds.includes(m.id)));
    setSelectedMaterialIds([]);
  };

  const removeBoundMaterial = (materialId: string) => {
    const removed = boundMaterials.find(m => m.id === materialId);
    setBoundMaterials(prev => prev.filter(m => m.id !== materialId));
    if (removed) {
      setMaterialList(prev => [
        ...prev,
        {
          id: removed.id,
          materialCode: removed.materialCode,
          materialName: removed.materialName,
          unit: '',
          status: 'active',
          mslLevel: '',
        } as Material,
      ]);
    }
  };

  const handleSave = async () => {
    if (!templateId) return;
    setSaving(true);
    try {
      await bindTemplateMaterials(templateId, boundMaterials.map(m => m.id));
      toast.success(t('message.saveSuccess'));
      onOpenChange(false);
      onSaved();
    } catch (error) {
      logger.error('bind template materials failed', error);
      toast.error(t('message.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('iqc.bindMaterial')}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4">
          {/* Left: available */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">{t('iqc.availableMaterials')}</label>
            <div className="flex gap-2">
              <Input
                value={materialSearch}
                onChange={(e) => setMaterialSearch(e.target.value)}
                placeholder={`${t('material.materialCode')} / ${t('material.materialName')}`}
                className="flex-1"
                onKeyDown={(e) => { if (e.key === 'Enter') searchMaterials(); }}
              />
              <Button size="sm" onClick={searchMaterials}>
                <Search size={14} />
              </Button>
            </div>
            <div className="border border-border rounded-md h-80 overflow-y-auto">
              {materialLoading ? (
                <div className="p-4 text-center text-sm text-muted-foreground">{t('common.loading')}</div>
              ) : materialList.length === 0 ? (
                <div className="p-4 text-center text-sm text-muted-foreground">{t('message.noData')}</div>
              ) : (
                materialList.map(m => (
                  <label
                    key={m.id}
                    className="flex items-center gap-2 px-3 py-2 hover:bg-muted cursor-pointer border-b border-border last:border-0 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={selectedMaterialIds.includes(m.id)}
                      onChange={(e) => {
                        setSelectedMaterialIds(prev =>
                          e.target.checked
                            ? [...prev, m.id]
                            : prev.filter(id => id !== m.id)
                        );
                      }}
                    />
                    <span className="font-medium">{m.materialCode}</span>
                    <span className="text-muted-foreground truncate">{m.materialName}</span>
                  </label>
                ))
              )}
            </div>
            <Button size="sm" onClick={addSelectedMaterials} disabled={selectedMaterialIds.length === 0}>
              → {t('iqc.bindMaterial')}
            </Button>
          </div>
          {/* Right: bound */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              {t('iqc.boundMaterials')} ({boundMaterials.length})
            </label>
            <div className="border border-border rounded-md h-[340px] overflow-y-auto">
              {boundMaterials.length === 0 ? (
                <div className="p-4 text-center text-sm text-muted-foreground">{t('message.noData')}</div>
              ) : (
                boundMaterials.map(m => (
                  <div
                    key={m.id}
                    className="flex items-center justify-between px-3 py-2 border-b border-border last:border-0 text-sm"
                  >
                    <div>
                      <span className="font-medium">{m.materialCode}</span>
                      <span className="text-muted-foreground ml-2">{m.materialName}</span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 text-destructive"
                      onClick={() => removeBoundMaterial(m.id)}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? t('common.saving') : t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default TemplateBindDialog;

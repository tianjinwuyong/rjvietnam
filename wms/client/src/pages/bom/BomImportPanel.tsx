import React, { useRef } from 'react';
import { useI18n, tf } from '@client/src/i18n';
import { Button } from '@client/src/components/ui/button';
import { Download, Upload } from 'lucide-react';
import { downloadBomTemplate, parseBomExcel } from '@client/src/utils/bom-import';
import type { BomItemInput } from '@client/src/api/bom';
import { logger } from '@client/src/utils/logger';
import { toast } from 'sonner';

interface BomImportPanelProps {
  onImported: (items: BomItemInput[]) => void;
  currentCount: number;
}

const BomImportPanel: React.FC<BomImportPanelProps> = ({ onImported, currentCount }) => {
  const { t, lang } = useI18n();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDownloadTemplate = () => {
    downloadBomTemplate(lang as 'zh' | 'en' | 'vi');
  };

  const handleChooseFile = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const fileName = file.name.toLowerCase();
    if (!fileName.endsWith('.xls') && !fileName.endsWith('.xlsx')) {
      toast.error(t('bom.importFormatError') || '请选择 .xls 或 .xlsx 文件');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    try {
      const result = await parseBomExcel(file);
      if (result.errors.length > 0) {
        // 有错行时不再「部分导入」：BOM 少 10 行比导入失败更危险（用量错会导致领料/成本全错），
        // 直接拒绝整份文件，让用户改完再导。
        const msg = result.errors.slice(0, 5).join('\n');
        const more = result.errors.length > 5 ? '\n... ' + tf('ui.还有 {n} 条错误', { n: result.errors.length - 5 }) : '';
        toast.error(
          `${t('bom.importValidationFailed') || '导入校验失败'}（${tf('ui.共 {n} 行有问题', { n: result.errors.length })}，${t('ui.未导入任何数据，请修正后重新导入')}）:\n${msg}${more}`,
        );
      } else if (result.items.length === 0) {
        toast.warning(t('bom.importEmpty') || '未解析到有效数据行');
      } else {
        onImported(result.items);
        toast.success(
          (t('bom.importSuccess') || '导入成功').replace('{count}', String(result.items.length)),
        );
      }
    } catch (error) {
      logger.error('Failed to parse BOM Excel:', String(error));
      toast.error(t('bom.importFailed') || '导入失败，请检查文件格式');
    }

    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="border border-dashed border-border rounded-lg p-4 bg-muted/20">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" onClick={handleDownloadTemplate} className="gap-2">
          <Download size={16} />
          {t('bom.downloadTemplate') || '下载模板'}
        </Button>
        <Button variant="default" size="sm" onClick={handleChooseFile} className="gap-2">
          <Upload size={16} />
          {t('bom.importExcel') || '选择Excel文件导入'}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xls,.xlsx"
          onChange={handleFileChange}
          className="hidden"
        />
        <span className="text-xs text-muted-foreground">
          {t('bom.importHint') || '支持 .xls / .xlsx 格式，导入后自动填充明细表格'}
        </span>
        {currentCount > 0 && (
          <span className="text-xs text-primary ml-auto">
            {t('bom.currentItems') || '已导入'} {currentCount} {t('common.items') || '条'}
          </span>
        )}
      </div>
    </div>
  );
};

export default BomImportPanel;

import React, { useEffect, useMemo, useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { Button } from '@client/src/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@client/src/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@client/src/components/ui/command';
import { cn } from '@/lib/utils';
import { useI18n } from '@client/src/i18n';

export interface MaterialOption {
  id: string;
  code: string;
  name: string;
}

export interface MaterialSelectProps {
  /** 当前选中的物料 id */
  value: string;
  onChange: (id: string) => void;
  /** 候选物料（由调用方决定范围，例如「某工单的物料」或「全部物料」） */
  options: MaterialOption[];
  placeholder?: string;
  emptyText?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * 可搜索物料下拉（Combobox）。
 *
 * 既能下拉选择，也能手工输入模糊过滤：
 * 排序规则为「编码/名称以关键词开头」优先，其后是「包含关键词」，
 * 因此输入 "1" 时，以 1 开头的物料排在最前，便于直接选取。
 */
const MaterialSelect: React.FC<MaterialSelectProps> = ({
  value,
  onChange,
  options,
  placeholder,
  emptyText,
  disabled,
  className,
}) => {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState('');

  const selected = useMemo(() => options.find((o) => o.id === value), [options, value]);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return options;
    const starts: MaterialOption[] = [];
    const contains: MaterialOption[] = [];
    for (const o of options) {
      const code = (o.code || '').toLowerCase();
      const name = (o.name || '').toLowerCase();
      if (code.startsWith(kw) || name.startsWith(kw)) starts.push(o);
      else if (code.includes(kw) || name.includes(kw)) contains.push(o);
    }
    return [...starts, ...contains];
  }, [options, keyword]);

  // 关闭时清空关键词，下次打开从完整列表开始
  useEffect(() => {
    if (!open) setKeyword('');
  }, [open]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            'w-full justify-between font-normal',
            !selected && 'text-muted-foreground',
            className,
          )}
        >
          <span className="truncate">
            {selected ? `${selected.code} - ${selected.name}` : (placeholder || t('common.pleaseSelect'))}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] p-0"
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={t('ui.输入物料编码或名称搜索')}
            value={keyword}
            onValueChange={setKeyword}
          />
          <CommandList>
            <CommandEmpty>{emptyText || t('common.noData')}</CommandEmpty>
            {filtered.map((o) => (
              <CommandItem
                key={o.id}
                value={o.id}
                onSelect={() => {
                  onChange(o.id);
                  setOpen(false);
                }}
              >
                <Check className={cn('mr-2 h-4 w-4', value === o.id ? 'opacity-100' : 'opacity-0')} />
                <span className="truncate">
                  {o.code} - {o.name}
                </span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

export default MaterialSelect;

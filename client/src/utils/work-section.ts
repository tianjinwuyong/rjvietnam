import { useI18n } from '@client/src/i18n';

const SECTION_NORMALIZE_MAP: Record<string, string> = {
  smt: 'smt',
  SMT: 'smt',
  'SMT贴片': 'smt',
  'smt贴片': 'smt',
  dip: 'dip',
  DIP: 'dip',
  'DIP插件': 'dip',
  'dip插件': 'dip',
  插件: 'dip',
  assembly: 'assembly',
  Assembly: 'assembly',
  ASSEMBLY: 'assembly',
  ASSY: 'assembly',
  assy: 'assembly',
  组装: 'assembly',
  pack: 'packing',
  Pack: 'packing',
  PACK: 'packing',
  packing: 'packing',
  Packing: 'packing',
  PACKING: 'packing',
  包装: 'packing',
  auxiliary: 'auxiliary',
  Auxiliary: 'auxiliary',
  AUXILIARY: 'auxiliary',
  辅料: 'auxiliary',
};

export function normalizeWorkSection(section: string | null | undefined): string {
  if (!section) return '';
  const key = SECTION_NORMALIZE_MAP[section];
  return key || section;
}

export function useWorkSectionLabel(): (section: string | null | undefined) => string {
  const { t } = useI18n();
  return (section: string | null | undefined): string => {
    if (!section) return '-';
    const normalized = normalizeWorkSection(section);
    return t(`bom.${normalized}`) || section;
  };
}

import { useState, useEffect, useCallback, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

/**
 * 统一的「筛选 + 分页」列表查询 Hook。
 *
 * 背景（修复的三个缺陷）：
 * 1. 翻页后筛选查不到 —— 旧写法把 page 与筛选条件都塞进 fetchData 的依赖，
 *    用户在页码 2 上改筛选条件时，请求仍带 page=2；结果集不足 2 页就返回空列表。
 *    本 Hook 保证：**筛选条件一旦提交，page 立即归 1**。
 * 2. 查询按钮失灵 —— 旧写法 `handleSearch = () => setPage(1)`，当 page 已是 1 时
 *    setState 不产生变化，useEffect 不会重跑，点按钮毫无反应。
 *    本 Hook 用 tick 计数器保证**每次提交都必然触发一次请求**。
 * 3. 边打字边请求 —— 旧写法输入框 onChange 直接改查询条件，每敲一个字符发一次请求，
 *    表格反复闪空。本 Hook 把「输入草稿」与「已提交条件」分离，
 *    仅点击查询 / 回车 / 重置时才提交。
 *
 * 用法：
 * ```tsx
 * const query = useSearchPagination<Filters>({ locationCode: '', status: '' });
 * const { page, pageSize, params, tick, list, setList, setTotal, setLoading } = query;
 *
 * const fetchData = useCallback(async () => {
 *   setLoading(true);
 *   try {
 *     const res = await getList({ page, pageSize, ...params });
 *     setList(res.items);
 *     setTotal(res.total);
 *   } finally { setLoading(false); }
 * }, [page, pageSize, params, tick, setList, setTotal, setLoading]);
 *
 * useEffect(() => { void fetchData(); }, [fetchData]);
 * ```
 * 输入框绑定 `query.draft.xxx` + `query.setDraft('xxx', v)`（回车提交用 `onKeyDown={query.onEnterSearch}`）；
 * 查询按钮 `onClick={query.search}`；重置按钮 `onClick={() => query.reset()}`。
 */
export interface UseSearchPaginationOptions {
  /** 每页条数，默认 20 */
  pageSize?: number;
}

export function useSearchPagination<P extends Record<string, any>>(
  initialParams: P,
  options: UseSearchPaginationOptions = {},
) {
  const { pageSize = 20 } = options;

  // 记住初始条件，供 reset() 使用（避免调用方每次传新对象导致引用漂移）
  const initialRef = useRef<P>({ ...initialParams });

  const [page, setPageState] = useState(1);
  const [params, setParams] = useState<P>({ ...initialParams });
  const [draft, setDraftState] = useState<P>({ ...initialParams });
  /** 请求版本号：提交/刷新/翻页时自增，破掉「setState 无变化 → 不请求」的死锁 */
  const [tick, setTick] = useState(0);

  const [list, setList] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const setDraft = useCallback(<K extends keyof P>(key: K, value: P[K]) => {
    setDraftState((prev) => ({ ...prev, [key]: value }));
  }, []);

  const patchDraft = useCallback((patch: Partial<P>) => {
    setDraftState((prev) => ({ ...prev, ...patch }));
  }, []);

  /** 提交筛选：把草稿写入已提交条件，归第 1 页，并强制触发一次请求 */
  const search = useCallback(() => {
    setParams({ ...draft });
    setPageState(1);
    setTick((n) => n + 1);
  }, [draft]);

  /** 重置：回到初始条件，归第 1 页并强制请求 */
  const reset = useCallback((next?: P) => {
    const base = next ? { ...next } : { ...initialRef.current };
    setDraftState({ ...base });
    setParams({ ...base });
    setPageState(1);
    setTick((n) => n + 1);
  }, []);

  /** 跳页：页码未变时也递增 tick，保证首屏失败后能重试 */
  const setPage = useCallback((p: number) => {
    setPageState(p);
    setTick((n) => n + 1);
  }, []);

  /** 增删改后刷新当前页 */
  const refresh = useCallback(() => setTick((n) => n + 1), []);

  /** 输入框回车即查询 */
  const onEnterSearch = useCallback(
    (e: ReactKeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        search();
      }
    },
    [search],
  );

  return {
    page,
    pageSize,
    params,
    draft,
    setDraft,
    patchDraft,
    search,
    reset,
    setPage,
    refresh,
    tick,
    list,
    total,
    loading,
    setList,
    setTotal,
    setLoading,
    onEnterSearch,
  };
}

export default useSearchPagination;

// Compatibility shim for @lark-apaas/client-toolkit
export function showConfirm(options: string | {
  title?: string;
  content?: string;
  onOk?: () => void | Promise<void>;
  onCancel?: () => void;
  okText?: string;
  cancelText?: string;
}): Promise<boolean> {
  const message = typeof options === 'string'
    ? options
    : (options.content || options.title || '确定执行此操作吗？');
  const confirmed = window.confirm(message);
  if (confirmed && typeof options !== 'string') {
    options.onOk?.();
  } else if (!confirmed && typeof options !== 'string') {
    options.onCancel?.();
  }
  return Promise.resolve(confirmed);
}

export default { showConfirm };

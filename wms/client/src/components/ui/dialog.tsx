"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { XIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { useI18n } from "@client/src/i18n"

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-[rgba(20_28_36_0.55)]",
        className
      )}
      {...props}
    />
  )
}

const DraggableDialogContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<typeof DialogPrimitive.Content> & { showCloseButton?: boolean }
>(({ className, children, showCloseButton = true, ...props }, ref) => {
  const { t } = useI18n();
  const contentRef = React.useRef<HTMLDivElement>(null);
  const dragState = React.useRef<{
    dragging: boolean;
    pointerId: number;
    startX: number;
    startY: number;
    originLeft: number;
    originTop: number;
    width: number;
    height: number;
  }>({
    dragging: false,
    pointerId: -1,
    startX: 0,
    startY: 0,
    originLeft: 0,
    originTop: 0,
    width: 0,
    height: 0,
  });

  const setRefs = React.useCallback((node: HTMLDivElement | null) => {
    (contentRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
    if (typeof ref === "function") ref(node);
    else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
  }, [ref]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!contentRef.current) return;
    const target = e.target as HTMLElement;

    if (target.closest(
      'button, input, textarea, select, label, [role="button"], [role="dialog"] [data-slot="dialog-close"], a, textarea'
    )) return;

    if (!target.closest('[data-drag-handle="true"]')) return;

    const el = contentRef.current;
    const rect = el.getBoundingClientRect();
    const s = dragState.current;
    s.dragging = true;
    s.pointerId = e.pointerId;
    s.startX = e.clientX;
    s.startY = e.clientY;
    s.originLeft = rect.left;
    s.originTop = rect.top;
    s.width = rect.width;
    s.height = rect.height;

    // 拖动开始：从「居中 + translate(-50%,-50%)」切换为像素定位，
    // 之后每次 pointermove 直接写 left/top —— 无 rAF 排队、无过渡动画，完全跟手（Excel 窗口式）
    // 注意：Tailwind v4 的居中偏移 -translate-x/y-1/2 用的是独立 CSS `translate` 属性，
    // 必须一并清掉，否则会与像素 left/top 叠加造成跳位（旧实现卡顿/跳位的根源）。
    el.style.transition = 'none';
    el.style.animation = 'none';
    el.style.left = `${rect.left}px`;
    el.style.top = `${rect.top}px`;
    el.style.right = 'auto';
    el.style.bottom = 'auto';
    el.style.margin = '0';
    el.style.transform = 'none';
    el.style.translate = 'none';
    el.style.scale = 'none';
    el.style.willChange = 'left, top';
    el.style.userSelect = 'none';
    el.style.cursor = 'grabbing';

    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const s = dragState.current;
    if (!s.dragging || e.pointerId !== s.pointerId || !contentRef.current) return;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let newLeft = s.originLeft + (e.clientX - s.startX);
    let newTop = s.originTop + (e.clientY - s.startY);

    // 边界限制：至少保留标题栏可见
    if (newLeft < -s.width + 80) newLeft = -s.width + 80;
    if (newLeft > vw - 80) newLeft = vw - 80;
    if (newTop < 0) newTop = 0;
    if (newTop > vh - 40) newTop = vh - 40;

    // 直接写样式，浏览器按输入事件频率即时呈现，不经过 rAF 排队（少一帧延迟）
    contentRef.current.style.left = `${newLeft}px`;
    contentRef.current.style.top = `${newTop}px`;
  };

  const endDrag = (e: React.PointerEvent) => {
    const s = dragState.current;
    if (!s.dragging || e.pointerId !== s.pointerId) return;

    s.dragging = false;

    if (contentRef.current) {
      const el = contentRef.current;
      // 位置已固化为像素定位；仅恢复文本选择，动画/过渡保持关闭（避免松手回弹）
      el.style.willChange = 'auto';
      el.style.userSelect = '';
      el.style.cursor = '';
    }

    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch { /* ignore */ }
  };

  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        ref={setRefs}
        className={cn(
          "bg-card data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed top-[50%] left-[50%] z-50 grid w-full max-sm:max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-[12px] border border-border p-6 shadow-[0_18px_50px_rgba(28_39_51_0.12)] duration-200 max-w-lg",
          className
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            className="ring-offset-background focus:ring-ring data-[state=open]:bg-accent data-[state=open]:text-muted-foreground absolute top-4 right-4 rounded-xs opacity-70 transition-opacity enabled:hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 cursor-pointer"
          >
            <XIcon />
            <span className="sr-only">{t('common.close')}</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
});
DraggableDialogContent.displayName = "DialogContent"

function DialogContent(props: React.ComponentProps<typeof DraggableDialogContent>) {
  return <DraggableDialogContent {...props} />;
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      data-drag-handle="true"
      className={cn("flex flex-col gap-2 text-center sm:text-left cursor-grab active:cursor-grabbing select-none", className)}
      {...props}
    />
  )
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    />
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      data-drag-handle="true"
      className={cn("text-base font-bold text-foreground", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}

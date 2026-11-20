import React from 'react';

export type PdaButtonVariant = 'primary' | 'success' | 'danger' | 'ghost';

interface PdaButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: PdaButtonVariant;
  fullWidth?: boolean;
  children: React.ReactNode;
}

const VARIANT_CLASS: Record<PdaButtonVariant, string> = {
  primary: 'pda-btn-primary',
  success: 'pda-btn-success',
  danger: 'pda-btn-danger',
  ghost: 'pda-btn-ghost',
};

/**
 * PDA 大按钮：最小高度 56px，支持 primary/success/danger/ghost 与全宽。
 */
const PdaButton: React.FC<PdaButtonProps> = ({
  variant = 'primary',
  fullWidth = false,
  className = '',
  children,
  ...rest
}) => {
  return (
    <button
      type="button"
      className={`pda-btn ${VARIANT_CLASS[variant]} ${fullWidth ? 'pda-btn-block' : ''} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
};

export default PdaButton;

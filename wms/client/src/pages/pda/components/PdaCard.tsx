import React from 'react';

interface PdaCardProps {
  title?: React.ReactNode;
  extra?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}

/**
 * PDA 卡片容器：白色背景、圆角、阴影，内边距 16px。
 */
const PdaCard: React.FC<PdaCardProps> = ({ title, extra, children, className = '', onClick }) => {
  return (
    <div className={`pda-card ${className}`} onClick={onClick}>
      {(title || extra) && (
        <div className="pda-card-head">
          <div className="pda-card-title">{title}</div>
          {extra && <div className="pda-card-extra">{extra}</div>}
        </div>
      )}
      <div className="pda-card-body">{children}</div>
    </div>
  );
};

export default PdaCard;

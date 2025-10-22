import React from 'react';

interface LogoProps {
  size?: 'small' | 'medium' | 'large';
  color?: 'light' | 'dark';
}

export default function Logo({ size = 'medium', color = 'dark' }: LogoProps) {
  // Size classes
  const sizeClasses = {
    small: 'text-xl',
    medium: 'text-2xl',
    large: 'text-3xl',
  };

  // Color classes
  const colorClasses = {
    light: 'text-white',
    dark: 'text-gray-800',
  };

  // Accent color
  const accentColor = color === 'light' ? 'text-red-300' : 'text-red-600';

  return (
    <div className={`font-bold ${sizeClasses[size]} ${colorClasses[color]} flex items-center`}>
      <span className="mr-1">GRAND</span>
      <span className={accentColor}>LINK</span>
      <span className="text-xs ml-2 font-normal mt-1">ADMIN</span>
    </div>
  );
}
import React from 'react'

// Primary emblem icon of the platform
export const BrandIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg 
    viewBox="0 0 24 24" 
    fill="none" 
    xmlns="http://www.w3.org/2000/svg" 
    {...props}
  >
    <path 
      d="M12 2L2 7L12 12L22 7L12 2Z" 
      fill="currentColor" 
      className="text-primary"
    />
    <path 
      d="M2 17L12 22L22 17M2 12L12 17L22 12" 
      stroke="currentColor" 
      strokeWidth="2" 
      strokeLinecap="round" 
      strokeLinejoin="round" 
      className="text-primary/70"
    />
  </svg>
)

// Large brand emblem for Auth screens
export const BrandAuthLogo: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg 
    viewBox="0 0 200 60" 
    fill="none" 
    xmlns="http://www.w3.org/2000/svg" 
    {...props}
  >
    {/* Geometric Badge Symbol */}
    <g transform="translate(10, 5)">
      <path d="M20 0L40 10L20 20L0 10L20 0Z" fill="url(#brandGrad)" />
      <path d="M0 20L20 30L40 20" stroke="url(#brandGrad)" strokeWidth="2" strokeLinecap="round" />
      <path d="M0 30L20 40L40 30" stroke="url(#brandGrad)" strokeWidth="2" strokeLinecap="round" />
    </g>

    {/* Typography */}
    <text 
      x="65" 
      y="35" 
      fill="currentColor" 
      fontSize="22" 
      fontWeight="800" 
      fontFamily="Saira Condensed"
      letterSpacing="0.08em"
      className="text-foreground"
    >
      ADARSH
    </text>
    <text 
      x="65" 
      y="48" 
      fill="currentColor" 
      fontSize="11" 
      fontWeight="600" 
      fontFamily="Saira Condensed"
      letterSpacing="0.25em"
      className="text-primary"
    >
      ID SYSTEM CORE
    </text>

    <defs>
      <linearGradient id="brandGrad" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="hsl(var(--primary))" />
        <stop offset="100%" stopColor="#06B6D4" />
      </linearGradient>
    </defs>
  </svg>
)

// Pulsing loader brand variant
export const BrandLoadingLogo: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg 
    viewBox="0 0 100 100" 
    fill="none" 
    xmlns="http://www.w3.org/2000/svg" 
    {...props}
  >
    <circle 
      cx="50" 
      cy="50" 
      r="40" 
      stroke="currentColor" 
      strokeWidth="2" 
      strokeDasharray="10 5" 
      className="text-primary/30 animate-spin" 
    />
    <path 
      d="M50 25L28 36L50 47L72 36L50 25Z" 
      fill="currentColor" 
      className="text-primary animate-pulse" 
    />
    <path 
      d="M28 58L50 69L72 58" 
      stroke="currentColor" 
      strokeWidth="3" 
      strokeLinecap="round" 
      className="text-primary" 
    />
  </svg>
)

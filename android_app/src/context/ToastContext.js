import React, { createContext, useContext, useState, useCallback } from 'react';
import Toast from '../components/Toast';

const ToastContext = createContext(null);

export const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([]);

  const hideToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const showToast = useCallback((message, type = 'info', duration = 3500) => {
    const id = Date.now() + Math.random();
    setToasts(prev => {
      const newList = [...prev, { id, message, type, duration }];
      return newList.slice(-2); // Keep max 2
    });
  }, []);

  return (
    <ToastContext.Provider value={{ showToast, hideToast }}>
      {children}
      {toasts.map((t, index) => (
        <Toast 
          key={t.id}
          index={index}
          visible={true} 
          message={t.message} 
          type={t.type} 
          duration={t.duration}
          onHide={() => hideToast(t.id)} 
        />
      ))}
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be inside ToastProvider');
  return context;
};


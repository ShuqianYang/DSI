'use client';

import { useState, useEffect } from 'react';
import { Eye, EyeOff, Lock, User, Smartphone } from 'lucide-react';
import LogoIcon from '@/components/LogoIcon';

interface LoginPageProps {
  onLogin: () => void;
}

export default function LoginPage({ onLogin }: LoginPageProps) {
  const [loginMethod, setLoginMethod] = useState<'password' | 'sms'>('password');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [verifyCode, setVerifyCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [errorCount, setErrorCount] = useState(0);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // 全局监听回车键，无需聚焦输入框即可触发登录
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        if (loginMethod === 'password') {
          handlePasswordLogin();
        } else {
          handleSmsLogin();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [loginMethod, username, password, phone, verifyCode]);

  const handlePasswordLogin = async () => {
    if (!username || !password) {
      setError('请输入用户名和密码');
      return;
    }

    if (errorCount >= 3) {
      setError('错误次数过多，请30分钟后再试');
      return;
    }

    setIsLoading(true);
    setError('');

    // 模拟登录
    setTimeout(() => {
      if (username === 'admin' && password === 'admin123') {
        onLogin();
      } else {
        setError('用户名或密码错误');
        setErrorCount((prev) => prev + 1);
      }
      setIsLoading(false);
    }, 1000);
  };

  const handleSmsLogin = async () => {
    if (!phone || !verifyCode) {
      setError('请输入手机号和验证码');
      return;
    }

    setIsLoading(true);
    setError('');

    // 模拟登录
    setTimeout(() => {
      if (phone === '13800000000' && verifyCode === '123456') {
        onLogin();
      } else {
        setError('验证码错误');
      }
      setIsLoading(false);
    }, 1000);
  };

  const sendVerifyCode = () => {
    if (!phone) {
      setError('请输入手机号');
      return;
    }
    // 模拟发送验证码
    alert('验证码已发送');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-tech-gradient relative overflow-hidden">
      {/* 背景装饰 */}
      <div className="absolute inset-0 overflow-hidden">
        {/* 网格背景 */}
        <div
          className="absolute inset-0 opacity-10"
          style={{
            backgroundImage: `
              linear-gradient(rgba(0, 224, 255, 0.1) 1px, transparent 1px),
              linear-gradient(90deg, rgba(0, 224, 255, 0.1) 1px, transparent 1px)
            `,
            backgroundSize: '50px 50px',
          }}
        />
        
        {/* 光晕效果 */}
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-[#00E0FF]/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-[#FF4444]/10 rounded-full blur-3xl" />
        
        {/* 浮动粒子 */}
        {[
          { left: 10, top: 15, delay: 0.5, duration: 2.5 },
          { left: 25, top: 30, delay: 1.2, duration: 3.1 },
          { left: 40, top: 8, delay: 0.8, duration: 2.8 },
          { left: 55, top: 45, delay: 2.0, duration: 3.5 },
          { left: 70, top: 20, delay: 1.5, duration: 2.2 },
          { left: 85, top: 60, delay: 0.3, duration: 3.8 },
          { left: 15, top: 70, delay: 1.8, duration: 2.6 },
          { left: 30, top: 85, delay: 2.5, duration: 3.2 },
          { left: 50, top: 75, delay: 0.7, duration: 2.9 },
          { left: 65, top: 90, delay: 1.1, duration: 3.4 },
          { left: 80, top: 35, delay: 2.2, duration: 2.4 },
          { left: 5, top: 50, delay: 0.9, duration: 3.6 },
          { left: 45, top: 55, delay: 1.6, duration: 2.7 },
          { left: 60, top: 10, delay: 2.8, duration: 3.0 },
          { left: 75, top: 40, delay: 0.4, duration: 2.3 },
          { left: 20, top: 95, delay: 1.9, duration: 3.7 },
          { left: 35, top: 65, delay: 0.6, duration: 2.1 },
          { left: 55, top: 25, delay: 2.3, duration: 3.3 },
          { left: 90, top: 55, delay: 1.3, duration: 2.0 },
          { left: 8, top: 80, delay: 2.7, duration: 3.9 },
        ].map((particle, i) => (
          <div
            key={i}
            className="absolute w-1 h-1 bg-[#00E0FF]/50 rounded-full animate-pulse"
            style={{
              left: `${particle.left}%`,
              top: `${particle.top}%`,
              animationDelay: `${particle.delay}s`,
              animationDuration: `${particle.duration}s`,
            }}
          />
        ))}
      </div>

      {/* 登录框 */}
      <div className="relative w-full max-w-md p-8 glass-panel rounded-2xl tech-border z-10">
        {/* Logo 和标题 */}
        <div className="text-center mb-8">
          <div className="w-24 h-24 mx-auto mb-4 rounded-2xl bg-[#00E0FF]/10 flex items-center justify-center border border-[#00E0FF]/30 text-[#00E0FF]">
            <LogoIcon size={64} />
          </div>
          <h1 className="text-2xl font-bold text-[#EAEAEA]">数智融合智能体</h1>
          <p className="text-sm text-[#8888AA] mt-2">Intelligence Fusion Agent Platform</p>
        </div>

        {/* 登录方式切换 */}
        <div className="flex mb-6 bg-[#2A2A3E] rounded-lg p-1">
          <button
            onClick={() => {
              setLoginMethod('password');
              setError('');
            }}
            className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
              loginMethod === 'password'
                ? 'bg-[#00E0FF] text-[#121212]'
                : 'text-[#8888AA] hover:text-[#EAEAEA]'
            }`}
          >
            <Lock className="w-4 h-4" />
            密码登录
          </button>
          <button
            onClick={() => {
              setLoginMethod('sms');
              setError('');
            }}
            className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
              loginMethod === 'sms'
                ? 'bg-[#00E0FF] text-[#121212]'
                : 'text-[#8888AA] hover:text-[#EAEAEA]'
            }`}
          >
            <Smartphone className="w-4 h-4" />
            短信登录
          </button>
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="mb-4 p-3 bg-[#FF4444]/10 border border-[#FF4444]/30 rounded-lg text-sm text-[#FF4444]">
            {error}
          </div>
        )}

        {/* 密码登录表单 */}
        {loginMethod === 'password' && (
          <div className="space-y-4">
            <div>
              <label className="text-sm text-[#8888AA]">用户名</label>
              <div className="relative mt-1">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#8888AA]" />
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="请输入用户名"
                  className="w-full pl-10 pr-4 py-3 bg-[#2A2A3E] border border-[#3A3A4E] rounded-lg text-[#EAEAEA] placeholder-[#8888AA] focus:outline-none focus:border-[#00E0FF] transition-colors"
                />
              </div>
            </div>
            <div>
              <label className="text-sm text-[#8888AA]">密码</label>
              <div className="relative mt-1">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#8888AA]" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="请输入密码"
                  className="w-full pl-10 pr-12 py-3 bg-[#2A2A3E] border border-[#3A3A4E] rounded-lg text-[#EAEAEA] placeholder-[#8888AA] focus:outline-none focus:border-[#00E0FF] transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8888AA] hover:text-[#EAEAEA] transition-colors"
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="w-4 h-4 rounded border-[#3A3A4E] bg-[#2A2A3E] text-[#00E0FF] focus:ring-[#00E0FF] focus:ring-offset-0"
                />
                <span className="text-sm text-[#8888AA]">记住密码</span>
              </label>
              <button className="text-sm text-[#00E0FF] hover:underline">忘记密码？</button>
            </div>
            <button
              onClick={handlePasswordLogin}
              disabled={isLoading}
              className="w-full py-3 bg-[#00E0FF] text-[#121212] rounded-lg font-medium hover:bg-[#00E0FF]/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <>
                  <div className="w-5 h-5 border-2 border-[#121212]/30 border-t-[#121212] rounded-full animate-spin" />
                  登录中...
                </>
              ) : (
                '登录'
              )}
            </button>
          </div>
        )}

        {/* 短信登录表单 */}
        {loginMethod === 'sms' && (
          <div className="space-y-4">
            <div>
              <label className="text-sm text-[#8888AA]">手机号</label>
              <div className="relative mt-1">
                <Smartphone className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#8888AA]" />
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="请输入手机号"
                  className="w-full pl-10 pr-4 py-3 bg-[#2A2A3E] border border-[#3A3A4E] rounded-lg text-[#EAEAEA] placeholder-[#8888AA] focus:outline-none focus:border-[#00E0FF] transition-colors"
                />
              </div>
            </div>
            <div>
              <label className="text-sm text-[#8888AA]">验证码</label>
              <div className="relative mt-1">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#8888AA]" />
                <input
                  type="text"
                  value={verifyCode}
                  onChange={(e) => setVerifyCode(e.target.value)}
                  placeholder="请输入验证码"
                  maxLength={6}
                  className="w-full pl-10 pr-28 py-3 bg-[#2A2A3E] border border-[#3A3A4E] rounded-lg text-[#EAEAEA] placeholder-[#8888AA] focus:outline-none focus:border-[#00E0FF] transition-colors"
                />
                <button
                  onClick={sendVerifyCode}
                  className="absolute right-2 top-1/2 -translate-y-1/2 px-3 py-1 bg-[#00E0FF]/10 text-[#00E0FF] rounded text-sm hover:bg-[#00E0FF]/20 transition-colors"
                >
                  获取验证码
                </button>
              </div>
            </div>
            <button
              onClick={handleSmsLogin}
              disabled={isLoading}
              className="w-full py-3 bg-[#00E0FF] text-[#121212] rounded-lg font-medium hover:bg-[#00E0FF]/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <>
                  <div className="w-5 h-5 border-2 border-[#121212]/30 border-t-[#121212] rounded-full animate-spin" />
                  登录中...
                </>
              ) : (
                '登录'
              )}
            </button>
          </div>
        )}

        {/* 底部提示 */}
        <div className="mt-6 text-center text-xs text-[#8888AA]">
          <p>温馨提示：</p>
          <p className="mt-1">不支持用户自主注册，账号由管理员统一分配</p>
          <p className="mt-1">忘记密码请联系管理员重置</p>
        </div>

        {/* 测试账号提示 */}
        <div className="mt-4 p-3 bg-[#2A2A3E] rounded-lg border border-[#3A3A4E]">
          <div className="text-xs text-[#8888AA] text-center">
            <p className="font-medium text-[#00E0FF]">测试账号</p>
            <p className="mt-1">用户名：admin | 密码：admin123</p>
            <p className="mt-1">手机号：13800000000 | 验证码：123456</p>
          </div>
        </div>
      </div>

      {/* 版本信息 */}
      <div className="absolute bottom-4 text-xs text-[#8888AA]">
        数智融合智能体平台 · v1.0.0
      </div>
    </div>
  );
}

'use client';

import { useState } from 'react';
import { User, Settings, Bell, Shield, LogOut, ChevronDown, Camera, MessageSquare } from 'lucide-react';
import { User as UserType } from '@/types/prd';

interface UserCenterProps {
  user: UserType;
  onLogout: () => void;
  onSettingsChange?: (settings: UserSettings) => void;
}

interface UserSettings {
  theme: 'dark' | 'light';
  fontSize: 'small' | 'medium' | 'large';
  alertSound: boolean;
  smsNotification: boolean;
}

export default function UserCenter({ user, onLogout, onSettingsChange }: UserCenterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<'profile' | 'settings' | null>(null);
  const [settings, setSettings] = useState<UserSettings>({
    theme: 'dark',
    fontSize: 'medium',
    alertSound: true,
    smsNotification: false,
  });

  const handleLogout = () => {
    onLogout();
    setIsOpen(false);
  };

  const handleSettingChange = (key: keyof UserSettings, value: boolean | string) => {
    const newSettings = { ...settings, [key]: value };
    setSettings(newSettings);
    onSettingsChange?.(newSettings);
  };

  return (
    <div className="relative">
      {/* 用户头像按钮 */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-[#2A2A3E] transition-colors"
      >
        <div className="w-8 h-8 rounded-full bg-[#00E0FF]/20 flex items-center justify-center overflow-hidden">
          {user.avatar ? (
            <img src={user.avatar} alt={user.name} className="w-full h-full object-cover" />
          ) : (
            <span className="text-[#00E0FF] text-sm font-medium">
              {user.name.charAt(0)}
            </span>
          )}
        </div>
        <div className="text-left hidden sm:block">
          <div className="text-sm text-[#EAEAEA] font-medium">{user.name}</div>
          <div className="text-xs text-[#8888AA]">{user.role}</div>
        </div>
        <ChevronDown className={`w-4 h-4 text-[#8888AA] transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* 下拉菜单 */}
      {isOpen && (
        <>
          {/* 背景遮罩 */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => {
              setIsOpen(false);
              setActiveSection(null);
            }}
          />
          
          {/* 菜单内容 */}
          <div className="absolute right-0 top-full mt-2 w-80 glass-panel rounded-lg shadow-xl z-50 overflow-hidden">
            {activeSection === null ? (
              <>
                {/* 用户信息 */}
                <div className="p-4 border-b border-[#3A3A4E]">
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <div className="w-14 h-14 rounded-full bg-[#00E0FF]/20 flex items-center justify-center">
                        {user.avatar ? (
                          <img src={user.avatar} alt={user.name} className="w-full h-full object-cover rounded-full" />
                        ) : (
                          <span className="text-[#00E0FF] text-xl font-medium">
                            {user.name.charAt(0)}
                          </span>
                        )}
                      </div>
                      <button className="absolute bottom-0 right-0 w-6 h-6 rounded-full bg-[#2A2A3E] border border-[#3A3A4E] flex items-center justify-center hover:bg-[#3A3A4E] transition-colors">
                        <Camera className="w-3 h-3 text-[#8888AA]" />
                      </button>
                    </div>
                    <div>
                      <div className="text-[#EAEAEA] font-medium">{user.name}</div>
                      <div className="text-sm text-[#8888AA]">{user.email}</div>
                      <div className="text-xs text-[#00E0FF] mt-1">{user.organization}</div>
                    </div>
                  </div>
                </div>

                {/* 菜单项 */}
                <div className="p-2">
                  <button
                    onClick={() => setActiveSection('profile')}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-[#2A2A3E] transition-colors text-left"
                  >
                    <User className="w-4 h-4 text-[#8888AA]" />
                    <span className="text-sm text-[#EAEAEA]">个人资料</span>
                  </button>
                  <button
                    onClick={() => setActiveSection('settings')}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-[#2A2A3E] transition-colors text-left"
                  >
                    <Settings className="w-4 h-4 text-[#8888AA]" />
                    <span className="text-sm text-[#EAEAEA]">设置中心</span>
                  </button>
                  <button
                    onClick={() => {
                      window.open('/info-center', '_blank', 'noopener,noreferrer');
                      setIsOpen(false);
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-[#2A2A3E] transition-colors text-left"
                  >
                    <MessageSquare className="w-4 h-4 text-[#8888AA]" />
                    <span className="text-sm text-[#EAEAEA]">信息中心</span>
                  </button>
                  <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-[#2A2A3E] transition-colors text-left">
                    <Bell className="w-4 h-4 text-[#8888AA]" />
                    <span className="text-sm text-[#EAEAEA]">消息提醒</span>
                    <span className="ml-auto w-5 h-5 rounded-full bg-[#FF4444] text-white text-xs flex items-center justify-center">
                      2
                    </span>
                  </button>
                  <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-[#2A2A3E] transition-colors text-left">
                    <Shield className="w-4 h-4 text-[#8888AA]" />
                    <span className="text-sm text-[#EAEAEA]">安全设置</span>
                  </button>
                </div>

                {/* 退出登录 */}
                <div className="p-2 border-t border-[#3A3A4E]">
                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-[#FF4444]/10 transition-colors text-left"
                  >
                    <LogOut className="w-4 h-4 text-[#FF4444]" />
                    <span className="text-sm text-[#FF4444]">退出登录</span>
                  </button>
                </div>
              </>
            ) : activeSection === 'profile' ? (
              <>
                {/* 个人资料 */}
                <div className="p-4 border-b border-[#3A3A4E]">
                  <button
                    onClick={() => setActiveSection(null)}
                    className="text-sm text-[#00E0FF] hover:underline"
                  >
                    ← 返回
                  </button>
                  <div className="text-[#EAEAEA] font-medium mt-3">个人资料</div>
                </div>
                <div className="p-4 space-y-4">
                  <div>
                    <label className="text-xs text-[#8888AA]">姓名</label>
                    <input
                      type="text"
                      defaultValue={user.name}
                      className="w-full mt-1 px-3 py-2 bg-[#2A2A3E] border border-[#3A3A4E] rounded-lg text-sm text-[#EAEAEA] focus:outline-none focus:border-[#00E0FF]"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-[#8888AA]">手机号</label>
                    <input
                      type="text"
                      defaultValue={user.phone}
                      disabled
                      className="w-full mt-1 px-3 py-2 bg-[#2A2A3E]/50 border border-[#3A3A4E] rounded-lg text-sm text-[#8888AA] cursor-not-allowed"
                    />
                    <div className="text-xs text-[#8888AA] mt-1">手机号为登录唯一标识，不可修改</div>
                  </div>
                  <div>
                    <label className="text-xs text-[#8888AA]">邮箱</label>
                    <input
                      type="email"
                      defaultValue={user.email}
                      className="w-full mt-1 px-3 py-2 bg-[#2A2A3E] border border-[#3A3A4E] rounded-lg text-sm text-[#EAEAEA] focus:outline-none focus:border-[#00E0FF]"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-[#8888AA]">所属单位</label>
                    <input
                      type="text"
                      defaultValue={user.organization}
                      className="w-full mt-1 px-3 py-2 bg-[#2A2A3E] border border-[#3A3A4E] rounded-lg text-sm text-[#EAEAEA] focus:outline-none focus:border-[#00E0FF]"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-[#8888AA]">角色</label>
                    <input
                      type="text"
                      defaultValue={user.role}
                      disabled
                      className="w-full mt-1 px-3 py-2 bg-[#2A2A3E]/50 border border-[#3A3A4E] rounded-lg text-sm text-[#8888AA] cursor-not-allowed"
                    />
                  </div>
                  <button className="w-full py-2 bg-[#00E0FF] text-[#121212] rounded-lg text-sm font-medium hover:bg-[#00E0FF]/80 transition-colors">
                    保存修改
                  </button>
                </div>
              </>
            ) : activeSection === 'settings' ? (
              <>
                {/* 设置中心 */}
                <div className="p-4 border-b border-[#3A3A4E]">
                  <button
                    onClick={() => setActiveSection(null)}
                    className="text-sm text-[#00E0FF] hover:underline"
                  >
                    ← 返回
                  </button>
                  <div className="text-[#EAEAEA] font-medium mt-3">设置中心</div>
                </div>
                <div className="p-4 space-y-6">
                  {/* 消息提醒设置 */}
                  <div>
                    <div className="text-sm text-[#EAEAEA] font-medium mb-3">消息提醒</div>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-sm text-[#EAEAEA]">告警声音</div>
                          <div className="text-xs text-[#8888AA]">收到告警时播放提示音</div>
                        </div>
                        <button
                          onClick={() => handleSettingChange('alertSound', !settings.alertSound)}
                          className={`w-10 h-6 rounded-full transition-colors relative ${
                            settings.alertSound ? 'bg-[#00E0FF]' : 'bg-[#3A3A4E]'
                          }`}
                        >
                          <div
                            className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                              settings.alertSound ? 'translate-x-5' : 'translate-x-1'
                            }`}
                          />
                        </button>
                      </div>
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-sm text-[#EAEAEA]">短信通知</div>
                          <div className="text-xs text-[#8888AA]">高危告警发送短信通知</div>
                        </div>
                        <button
                          onClick={() => handleSettingChange('smsNotification', !settings.smsNotification)}
                          className={`w-10 h-6 rounded-full transition-colors relative ${
                            settings.smsNotification ? 'bg-[#00E0FF]' : 'bg-[#3A3A4E]'
                          }`}
                        >
                          <div
                            className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                              settings.smsNotification ? 'translate-x-5' : 'translate-x-1'
                            }`}
                          />
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* 系统配置 */}
                  <div>
                    <div className="text-sm text-[#EAEAEA] font-medium mb-3">系统配置</div>
                    <div className="space-y-3">
                      <div>
                        <div className="text-xs text-[#8888AA] mb-2">界面配色</div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleSettingChange('theme', 'dark')}
                            className={`flex-1 py-2 rounded-lg text-sm transition-colors ${
                              settings.theme === 'dark'
                                ? 'bg-[#00E0FF] text-[#121212]'
                                : 'bg-[#2A2A3E] text-[#EAEAEA] hover:bg-[#3A3A4E]'
                            }`}
                          >
                            深色科技风
                          </button>
                          <button
                            onClick={() => handleSettingChange('theme', 'light')}
                            className={`flex-1 py-2 rounded-lg text-sm transition-colors ${
                              settings.theme === 'light'
                                ? 'bg-[#00E0FF] text-[#121212]'
                                : 'bg-[#2A2A3E] text-[#EAEAEA] hover:bg-[#3A3A4E]'
                            }`}
                          >
                            浅色
                          </button>
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-[#8888AA] mb-2">字体大小</div>
                        <div className="flex gap-2">
                          {(['small', 'medium', 'large'] as const).map((size) => (
                            <button
                              key={size}
                              onClick={() => handleSettingChange('fontSize', size)}
                              className={`flex-1 py-2 rounded-lg text-sm transition-colors ${
                                settings.fontSize === size
                                  ? 'bg-[#00E0FF] text-[#121212]'
                                  : 'bg-[#2A2A3E] text-[#EAEAEA] hover:bg-[#3A3A4E]'
                              }`}
                            >
                              {size === 'small' ? '小' : size === 'medium' ? '中' : '大'}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

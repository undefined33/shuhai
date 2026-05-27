export const SETUP_STEP_COPY = {
  chrome: 'ShuHai 会读取你的 Chrome 书签进行整理。请选择要同步的浏览器配置文件。',
  vault: '选择你的 Obsidian 笔记库目录，导出的书签会保存在这里。',
  ai: 'DeepSeek 是可选的 AI 分类服务。留空会使用内置规则分类；获取 Key: platform.deepseek.com。',
} as const;

export const CHROME_NOT_DETECTED_MESSAGE =
  '未检测到 Chrome 浏览器，请确认已安装。你仍可继续使用 Default，稍后也能在设置中调整。';

export interface ChromeProfileDetection {
  profiles: string[];
  selectedProfile: string;
  warning: string | null;
}

export function normalizeChromeProfileDetection(
  detectedProfiles: string[],
): ChromeProfileDetection {
  if (detectedProfiles.length > 0) {
    return {
      profiles: detectedProfiles,
      selectedProfile: detectedProfiles[0] ?? 'Default',
      warning: null,
    };
  }

  return {
    profiles: ['Default'],
    selectedProfile: 'Default',
    warning: CHROME_NOT_DETECTED_MESSAGE,
  };
}

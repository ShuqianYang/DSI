import os

# MODEL_SERVER = 'https://htmaas.local.ai:30443/v1'
#API_KEY = '6f4a70f368984347afa1adec83726317'
#MODEL =  'ea791fcd65dd48aa84f3ae03147e059f'   #Qwen3-14B

# API_KEY = "b528689030d74c8d8819ab0e3478f1e3"
# MODEL = "b8dedf27c8b54fdabb4f89ea8b3a2bf5" # Qwen235B-Instruct
# MODEL_NAME = "3485e42d85fa49ef82ad70479368ac09" # Qwen32B
# MODEL_NAME = "8d793ba6f79e4bc5a2de103355ea678d" # 天玄-成务
# MODEL_SERVER = "http://172.16.0.3:8005/v1"
# MODEL =  '3485e42d85fa49ef82ad70479368ac09'
# API_KEY = 'b528689030d74c8d8819ab0e3478f1e3'

# ----------------------------
# 模型连接配置
# ----------------------------

# # 裸服务器的开物32B   可以使用 在docker和本地都可以,docker里plan_notebook的内置工具正常调用（试了2次），服务器本地3次成功2次。不能百分比保证工具调用可靠  啰嗦
# MODEL = os.getenv("MODEL", "TX-KW-32B-v8")
# API_KEY = os.getenv("API_KEY", "txkwhtlydmx1234567")
# MODEL_SERVER = os.getenv("MODEL_SERVER", "http://10.0.0.8:8247/v1")

# 成务
# MODEL = os.getenv("MODEL", "1018-ht")
# API_KEY = os.getenv("API_KEY", "")
# MODEL_SERVER = os.getenv("MODEL_SERVER", "http://10.0.0.8:8011/v1")

# 裸服务器的千问14b  没开工具auto  2个环境都报 '"auto" tool choice requires的错
# MODEL_SERVER = os.getenv("MODEL_SERVER", 'http://10.0.0.7:20014/v1')
# MODEL = os.getenv("MODEL", 'qwen3-14B')
# API_KEY = os.getenv("API_KEY", '')

# MODEL_SERVER = os.getenv("MODEL_SERVER", 'http://10.0.0.7:20125/v1')
# MODEL = os.getenv("MODEL", 'qwen3-32b')
# API_KEY = os.getenv("API_KEY", '')

#画图
# DRAW_PLOT_API_KEY = '6f4a70f368984347afa1adec83726317'
# DRAW_PLOT_MODEL_SERVER = 'https://htmaas.local.ai:30443/v1'
# DRAW_PLOT_MODEL =  'ea791fcd65dd48aa84f3ae03147e059f'


# 息壤的千问30B
# MODEL_SERVER = 'https://htmaas.local.ai:30443/v1'
# MODEL = '676e70d897674f3e921794a3c8fd3682'
# API_KEY = 'b528689030d74c8d8819ab0e3478f1e3'


# # 阿里百练 qwen3-32b
# MODEL = os.getenv("MODEL", "qwen3-32b")
# API_KEY = os.getenv("API_KEY", "sk-ab87a04cd02e40108feb4117f4e9d2b0")
# MODEL_SERVER = os.getenv("MODEL_SERVER", "https://dashscope.aliyuncs.com/compatible-mode/v1")

# 阿里百练 qwen3.5-27b
MODEL = os.getenv("MODEL", "qwen3.5-27b")
API_KEY = os.getenv("API_KEY", "sk-ab87a04cd02e40108feb4117f4e9d2b0")
MODEL_SERVER = os.getenv("MODEL_SERVER", "https://dashscope.aliyuncs.com/compatible-mode/v1")

# # ollama-4090服务器
# MODEL = os.getenv("MODEL", "qwen3:14b-int8")
# API_KEY = os.getenv("API_KEY", "")
# # MODEL_SERVER = os.getenv("MODEL_SERVER", "http://192.168.0.212:11434/api/chat")
# MODEL_SERVER = os.getenv("MODEL_SERVER", "http://192.168.0.212:11434/v1")

# # 智算服务器开物
# MODEL = os.getenv("MODEL", "TX-KW-32B-v8")
# API_KEY = os.getenv("API_KEY", "")
# MODEL_SERVER = os.getenv("MODEL_SERVER", "http://192.168.0.27:18015/v1")

# # 智算服务器qwen3.5-27b
# MODEL = os.getenv("MODEL", "qwen3.5-27b")
# API_KEY = os.getenv("API_KEY", "")
# MODEL_SERVER = os.getenv("MODEL_SERVER", "http://192.168.0.27:8000/v1")


# ----------------------------
# PostgreSQL 连接配置
# ----------------------------
# DB_CONFIG = {
#     'user': os.getenv("DB_CONFIG_USER", 'root'),
#     'password': os.getenv("DB_CONFIG_PWD", 'pwd123'),
#     'host': os.getenv("DB_CONFIG_HOST", '10.0.0.4'),
#     'port': os.getenv("DB_CONFIG_PORT", 5432),
#     'database': os.getenv("DB_CONFIG_DATABASE", 'sqldata_v2'),  # 替换为实际数据库名
#     'connect_timeout': os.getenv("DB_CONFIG_CONNECT_TIMEOUT", 10)
# }

# ----------------------------
# MySQL 配置
# ----------------------------

# # 体系院数据库
# DB_CONFIG = {
#     'user': os.getenv("DB_CONFIG_USER", 'appuser'),
#     'password': os.getenv("DB_CONFIG_PWD", 'StrongPwd123!'),
#     'host': os.getenv("DB_CONFIG_HOST", '192.168.6.3'),
#     'port': int(os.getenv("DB_CONFIG_PORT", 23306)),  # 新增，解决port字符串格式问题
#     'database': os.getenv("DB_CONFIG_DATABASE", 'wtdb'),  # 替换为实际数据库名

# 本机xj数据库 
DB_CONFIG = {
    'user': os.getenv("DB_CONFIG_USER", 'root'),
    'password': os.getenv("DB_CONFIG_PWD", 'root'),
    'host': os.getenv("DB_CONFIG_HOST", '127.0.0.1'),
    'port': int(os.getenv("DB_CONFIG_PORT", 3306)),
    # 'database': os.getenv("DB_CONFIG_DATABASE", 'bjzhdd_XJ'),  # 替换为实际数据库名
    'database': os.getenv("DB_CONFIG_DATABASE", 'xjzhdd_bj'),  # 替换为实际数据库名
    'charset': os.getenv("DB_CONFIG_CHARSET", 'utf8mb4')
}

#     'charset': os.getenv("DB_CONFIG_CHARSET", 'utf8mb4')
# }

# 文件保存目录
OUTPUT_DIR = os.getenv("OUTPUT_DIR", "./query_results")
FIGURE_DIR = os.getenv("FIGURE_DIR", "./figure")
REPORT_DIR = os.getenv("REPORT_DIR", "./report")
# 文件保留天数
RETAIN_DAYS = os.getenv("RETAIN_DAYS", "30")

import os
QA_REPORT_DATA_DETAIL_STATUS = os.environ.get('QA_REPORT_DATA_DETAIL_STATUS', 'disabled')  # enabled

import json
import traceback
import uuid

import httpx
import time
import asyncio
from typing import List
import re
from agentscope.pipeline import stream_printing_messages
from agentscope.agent import ReActAgent, UserAgent
from agentscope.model import OpenAIChatModel
from agentscope.tool import Toolkit
from agentscope.memory import InMemoryMemory
from agentscope.message import Msg, TextBlock
from utils.openai_formatter_thinking import OpenAIChatFormatterWithThinking
from agentscope.tool._response import ToolResponse
import pymysql

# 处理直接运行时的导入路径
import sys
from pathlib import Path
if __name__ == "__main__":
    project_root = Path(__file__).parent.parent
    sys.path.insert(0, str(project_root))
    __package__ = "qa"

from datetime import datetime
# from .system_prompt_qa import sys_prompt_data_detail
# from .system_prompt_qa import sys_prompt_data
from .system_prompt_qa import sys_prompt_data_detail_query_rewrite  # 用于查明细
from .system_prompt_qa import sys_prompt_data_detail_merge_sql_operation  # 用于查明细
from .system_prompt_qa import sys_prompt_data_merge_sql_operation  # 用于主流程
from .system_prompt_qa import sys_prompt_figure_report  # 用于主流程

# 解决问题1：智能体不知道当前时间
def get_current_date_hint() -> str:
    """生成当前日期提示，注入到系统提示中，确保智能体知道当前真实时间"""
    now = datetime.now()
    weekday_en = now.strftime("%A")
    weekday_map = {
        'Monday': '星期一', 'Tuesday': '星期二', 'Wednesday': '星期三',
        'Thursday': '星期四', 'Friday': '星期五', 'Saturday': '星期六', 'Sunday': '星期日'
    }
    weekday_cn = weekday_map.get(weekday_en, weekday_en)
    return (
        f"【重要时间参考】当前系统日期是 {now.strftime('%Y年%m月%d日')} {weekday_cn}。"
        f"当用户问题中没有明确指定年份或月份时，默认查询的时间范围为今年本月（{now.strftime('%Y年%m月')}），"
        f"禁止默认使用2024年或其他年份。\n\n"
    )


# ---------------------------- 解决问题：自我介绍拦截 ----------------------------
SELF_INTRODUCTION_TEXT = (
    "您好，我是边防智能问答助手，专注于边防数据的智能分析与问答。我可以帮您：\n\n"
    "1. **数据查询**：查询预警事件、设备状态、人员/车辆通行记录、卡口往来等信息；\n"
    "2. **统计分析**：对边防数据进行多维度统计，如预警分级统计、设备在线率分析、通行流量统计、处理时效分析等；\n"
    "3. **趋势分析**：分析特定时间段内的数据变化趋势，识别异常时段和高风险区域；\n"
    "4. **可视化展示**：根据查询结果自动生成柱状图、折线图、饼图等图表，辅助分析决策；\n"
    "5. **明细查询**：查看预警事件、设备、卡口、部门等详细信息。\n\n"
    "请直接告诉我您想了解哪些边防数据，我会为您查询并分析。"
)

# 自我介绍类问题的关键词模式
_SELF_INTRO_KEYWORDS = [
    "你是谁", "你是什么", "你能做什么", "你能帮我做什么", "你有什么功能",
    "介绍一下你自己", "自我介绍", "你的能力", "你会什么", "你擅长什么",
    "你的作用", "你是干什么的", "你可以做什么", "你有什么用",
]


def is_self_introduction_query(query: str) -> bool:
    """
    判断用户查询是否为自我介绍类问题。
    支持部分匹配，如"你是谁？你能做什么？"也能被识别。
    """
    if not query:
        return False
    q = query.strip().lower()
    # 移除常见标点，便于匹配
    q_clean = q.replace("？", "").replace("?", "").replace("！", "").replace("!", "").replace("。", "").replace("，", ",")
    for kw in _SELF_INTRO_KEYWORDS:
        if kw in q_clean or kw in q:
            return True
    return False


# ---------------------------- 解决问题：无关问题拦截 ----------------------------
IRRELEVANT_RESPONSE_TEXT = (
    "抱歉，这个问题超出了我的能力范围。我是边防智能问答助手，"
    "只能回答与边防业务数据库相关的问题，无法处理天气、新闻、生活、娱乐、编程等通用问题。\n\n"
    "我可以帮您查询和分析以下内容：\n"
    "1. **预警事件**：预警分级统计、预警类型分布、误报/测警分析、处理时效、高风险区域等；\n"
    "2. **卡口通行记录**：车辆/人员进出记录、白名单/黑名单车辆、通行流量趋势、异常通行识别等；\n"
    "3. **设备信息**：设备在线/离线状态、摄像头/传感器运行情况、设备安装位置、设备故障统计等；\n"
    "4. **区域与部门**：各部门预警处理情况、区域通行往来统计、卡口与部门关联分析等；\n"
    "5. **数据可视化**：根据查询结果自动生成柱状图、折线图、饼图等统计图表。\n\n"
    "您可以这样提问：\n"
    "• “最近一周的一级预警有多少条？”\n"
    "• “查询昨天所有白名单车辆通行记录。”\n"
    "• “统计各卡口本月的车辆进出数量。”\n"
    "• “本月设备离线率是多少？”\n"
    "• “ top 5 的高风险预警区域有哪些？”\n\n"
    "请重新描述您的边防数据查询需求，我会尽力为您解答。"
)

# 数据意图关键词：只要包含以下任一关键词，就不视为无关问题
# 注意：不要放入过于通用的词汇（如"今天""最近"等时间词），否则容易误判
_DATA_INTENT_KEYWORDS = [
    "预警", "告警", "事件", "报警", "入侵", "误报", "测警",
    "设备", "摄像头", "传感器", "枪机", "球机", "在线", "离线",
    "大门", "卡口", "通行", "进出", "车辆", "人员", "车牌", "往来",
    "白名单", "黑名单", "陌生人",
    "部门", "区域", "位置", "安装",
    "统计", "查询", "查一下", "查下", "多少", "数量", "排名", "top", "最多", "最少", "最大", "最小", "平均", "占比", "比例",
    "处理", "处置", "研判", "响应", "上报",
    "考勤", "巡逻",
]

# 无关问题关键词：不包含数据意图关键词，且包含以下关键词时，判定为无关问题
_IRRELEVANT_KEYWORDS = [
    "天气", "气温", "温度", "下雨", "下雪", "刮风", "台风", "雾霾", "冰雹",
    "新闻", "头条", "热点", "股票", "基金", "彩票", "房价",
    "诗歌", "作文", "写文章", "写一首", "故事", "小说",
    "代码", "编程", "程序", "bug", "python", "java", "c++",
    "吃什么", "美食", "餐厅", "推荐", "好吃", "菜谱",
    "笑话", "谜语", "脑筋急转弯",
    "翻译", "英文", "英语", "日语", "韩语",
    "星座", "运势", "算命", "塔罗",
    "电影", "电视剧", "综艺", "音乐", "歌曲", "歌手",
    "旅游", "景点", "酒店", "机票", "火车票",
    "健康", "看病", "症状", "药品", "吃药",
]


def is_irrelevant_query(query: str) -> bool:
    """
    判断用户查询是否为与边防数据无关的问题。
    采用排除法：如果包含任何数据意图关键词，则不是无关问题；
    如果不包含数据意图关键词，且包含明显的无关关键词，则判定为无关问题。
    """
    if not query:
        return False
    q = query.strip().lower()
    # 移除常见标点
    q_clean = q.replace("？", "").replace("?", "").replace("！", "").replace("!", "").replace("。", "").replace("，", ",")

    # 如果包含数据意图关键词，则不是无关问题（优先放行）
    for kw in _DATA_INTENT_KEYWORDS:
        if kw in q_clean or kw in q:
            return False

    # 不包含数据意图关键词，再检查是否包含明显的无关关键词
    for kw in _IRRELEVANT_KEYWORDS:
        if kw in q_clean or kw in q:
            return True

    # 既不包含数据意图，也不包含明显的无关关键词，交由大模型判断（不拦截）
    return False


import matplotlib.pyplot as plt
import pandas as pd
import numpy as np
from typing import Optional
from io import StringIO

from config import API_KEY, MODEL, MODEL_SERVER, FIGURE_DIR, OUTPUT_DIR, REPORT_DIR, DB_CONFIG
from utils.streaming_hook_thinking_merge import _stream_hook, new_pre_type
from utils.stream_output import stream_message, stream_text
from utils.util import safe_timestamp, remove_think_tags, close_agent, sanitize_query_result


# ----------------------------
# 创建柱状图
# ----------------------------
def create_bar_chart(data: str,
                     x_col: str,
                     y_col: str,
                     title: str = "Bar Chart",
                     xlabel: str = "X Axis",
                     ylabel: str = "Y Axis",
                     figsize: tuple = (12, 8),
                     color: str = "skyblue",
                     edgecolor: str = "black",
                     alpha: float = 0.8,
                     grid: bool = True,
                     rotation: int = 45,
                     show_values: bool = True,
                     value_format: str = ".1f",
                     save_path: Optional[str] = None,
                     dpi: int = 300,
                     show: bool = True) -> ToolResponse:
                    #  -> plt.Figure:
    """
    创建柱状图的通用函数
    
    Parameters:
    -----------
    data : str
        csv格式的绘图数据
    x_col : str
        X轴数据列名（分类变量）
    y_col : str
        Y轴数据列名（数值变量）
    title : str, default="Bar Chart"
        图表标题
    xlabel : str, default="X Axis"
        X轴标签
    ylabel : str, default="Y Axis"
        Y轴标签
    figsize : tuple, default=(12, 8)
        图表尺寸
    color : str, default="skyblue"
        柱状图颜色
    edgecolor : str, default="black"
        柱状图边框颜色
    alpha : float, default=0.8
        透明度
    grid : bool, default=True
        是否显示网格
    rotation : int, default=45
        X轴标签旋转角度
    show_values : bool, default=True
        是否在柱子上显示数值
    value_format : str, default=".1f"
        数值显示格式
    save_path : str, optional
        保存路径，如果提供则保存图像
    dpi : int, default=300
        图像分辨率
    show : bool, default=True
        是否显示图表
    
    Returns:
    --------
    plt.Figure
        创建的图表对象
    """
    data = StringIO(data)

    # 使用read_csv读取
    data = pd.read_csv(data)
    # print(data)

    # 生成文件名
    if not save_path:
        # unique_id = uuid.uuid4()        
        save_path = os.path.join(FIGURE_DIR, f"bar_chart_{safe_timestamp()}.png")


    # 设置图表字体
    plt.rcParams.update({
        'font.sans-serif': ['WenQuanYi Zen Hei'],
        'axes.unicode_minus': False,
    })

    # 创建图表
    plt.figure(figsize=figsize)
    # 解决问题：柱状图横轴小数点
    # 绘制柱状图（使用序号作为X轴位置，避免数值型分类变量出现小数刻度）
    x_pos = range(len(data))
    bars = plt.bar(x_pos, data[y_col], 
                   color=color, 
                   edgecolor=edgecolor, 
                   alpha=alpha)
    
    # 设置标题和标签
    plt.title(title, fontsize=14, pad=20)
    plt.xlabel(xlabel, fontsize=12)
    plt.ylabel(ylabel, fontsize=12)
    
    # 使用原始分类标签替换X轴刻度，避免数值型数据出现小数刻度
    plt.xticks(x_pos, data[x_col], rotation=rotation, ha='right')
    
    # 在柱子上显示数值
    if show_values:
        for bar in bars:
            height = bar.get_height()
            plt.text(bar.get_x() + bar.get_width() / 2., height + height * 0.01,
                    f'{height:{value_format}}', 
                    ha='center', va='bottom', fontsize=10)
    
    # 强制纵轴刻度为正整数，禁止出现小数
    from matplotlib.ticker import MaxNLocator
    ax = plt.gca()
    ax.yaxis.set_major_locator(MaxNLocator(integer=True))

    # 添加网格
    if grid:
        plt.grid(True, axis='y', alpha=0.3)
    
    plt.tight_layout()
    
    # 保存图像
    if save_path:
        plt.savefig(save_path, dpi=dpi, bbox_inches='tight')
        print(f"柱状图已保存至: {save_path}")
    
    # 显示图表
    if show:
        plt.show()
    else:
        plt.close()
    
    # return plt.gcf()
    result = f"工具产出的图剖保存路径img_generation_url为：{save_path} 该路径为真实图片路径,严禁引用其他路径"
    return ToolResponse(content=[TextBlock(type='text', text=json.dumps({
        'status': 'success',
        # 'results': results
        "timestamp":str(safe_timestamp()),
        'result':result,
        'img_generation_url': save_path
    }, ensure_ascii=False))])

# ----------------------------
# 创建折线图
# ----------------------------
def create_line_chart(data: str,
                     x_col: str,
                     y_cols: List[str],
                     title: str = "Line Plot",
                     xlabel: str = "X Axis",
                     ylabel: str = "Y Axis",
                     figsize: tuple = (12, 8),
                     marker: str = "o",
                     linewidth: float = 2,
                     grid: bool = True,
                     legend: bool = True,
                     save_path: Optional[str] = None,
                     dpi: int = 300,
                     show: bool = True) -> ToolResponse:
                    #  -> plt.Figure:
    """
    创建折线图的通用函数
    
    Parameters:
    -----------
    data : str
        csv格式的绘图数据
    x_col : str
        X轴数据列名
    y_cols : List[str]
        Y轴数据列名列表
    title : str, default="Line Plot"
        图表标题
    xlabel : str, default="X Axis"
        X轴标签
    ylabel : str, default="Y Axis"
        Y轴标签
    figsize : tuple, default=(12, 8)
        图表尺寸
    marker : str, default="o"
        数据点标记样式
    linewidth : float, default=2
        线宽
    grid : bool, default=True
        是否显示网格
    legend : bool, default=True
        是否显示图例
    save_path : str, optional
        保存路径，如果提供则保存图像
    dpi : int, default=300
        图像分辨率
    show : bool, default=True
        是否显示图表
    
    Returns:
    --------
    plt.Figure
        创建的图表对象
    """
    data = StringIO(data)

    # 使用read_csv读取
    data = pd.read_csv(data)
    # print(data)

    # 生成文件名
    if not save_path:
        # unique_id = uuid.uuid4()
        save_path = os.path.join(FIGURE_DIR, f"line_chart_{safe_timestamp()}.png")

    # 设置图表字体
    plt.rcParams.update({
        'font.sans-serif': ['WenQuanYi Zen Hei'],
        'axes.unicode_minus': False,
    })
    
    # 创建图表
    plt.figure(figsize=figsize)
    
    # 绘制折线图
    for y_col in y_cols:
        plt.plot(data[x_col], data[y_col], 
                marker=marker, 
                linewidth=linewidth, 
                label=y_col)
    
    # 设置标题和标签
    plt.title(title, fontsize=14, pad=20)
    plt.xlabel(xlabel, fontsize=12)
    plt.ylabel(ylabel, fontsize=12)
    
    # 在折线数据点上标注数值
    for y_col in y_cols:
        for idx, val in enumerate(data[y_col]):
            plt.text(idx, val, f'{val}', ha='center', va='bottom', fontsize=8)
    
    # 添加网格和图例
    if grid:
        plt.grid(True, alpha=0.3)
    if legend:
        plt.legend(fontsize=10)
    
    plt.tight_layout()
    
    # 保存图像
    if save_path:
        plt.savefig(save_path, dpi=dpi, bbox_inches='tight')
        print(f"折线图已保存至: {save_path}")
    
    # 显示图表
    if show:
        plt.show()
    else:
        plt.close()
    
    # return plt.gcf()
    
    # return ToolResponse(content=[TextBlock(type='text', text=json.dumps({
    #     'status': 'success',
    #     # 'results': results
    #     'img_generation_url': save_path
    # }, ensure_ascii=False))])

    result = f"工具产出的图剖保存路径img_generation_url为：{save_path} 该路径为真实图片路径,严禁引用其他路径"
    return ToolResponse(content=[TextBlock(type='text', text=json.dumps({
        'status': 'success',
        # 'results': results
        "timestamp":str(safe_timestamp()),
        'result':result,
        'img_generation_url': save_path
    }, ensure_ascii=False))])

# ----------------------------
# 创建饼状图
# ----------------------------
def create_pie_chart(data: str,
                     labels_col: str,
                     values_col: str,
                     title: str = "Pie Chart",
                     figsize: tuple = (10, 8),
                     colors: Optional[List[str]] = None,
                     autopct: str = '%1.1f%%',
                     startangle: int = 90,
                     explode: Optional[List[float]] = None,
                     shadow: bool = True,
                     legend: bool = True,
                     save_path: Optional[str] = None,
                     dpi: int = 300,
                     show: bool = True) -> ToolResponse:
                    #  -> plt.Figure:
    """
    创建饼状图的通用函数
    
    Parameters:
    -----------
    data : str
        csv格式的绘图数据(标签为第一列，数值为第二列)
    labels_col : str
        标签数据列名
    values_col : str
        数值数据列名
    title : str, default="Pie Chart"
        图表标题
    figsize : tuple, default=(10, 8)
        图表尺寸
    colors : List[str], optional
        颜色列表，如果为None则使用默认颜色
    autopct : str, default='%1.1f%%'
        百分比显示格式
    startangle : int, default=90
        起始角度
    explode : List[float], optional
        各部分突出显示的距离
    shadow : bool, default=True
        是否显示阴影
    legend : bool, default=True
        是否显示图例
    save_path : str, optional
        保存路径，如果提供则保存图像
    dpi : int, default=300
        图像分辨率
    show : bool, default=True
        是否显示图表
    
    Returns:
    --------
    plt.Figure
        创建的图表对象
    """
    data = StringIO(data)

    # 使用read_csv读取
    # df = pd.read_csv(data)
    data = pd.read_csv(data)
    print(f"pie_chart data：{data}")
    # print(data)

    # # 转置并重置索引
    # df_transposed = df.T.reset_index()

    # # 将转置后的DataFrame转换回CSV字符串
    # output = StringIO()
    # df_transposed.to_csv(output, index=False, header=False)
    # result = output.getvalue()
    # print(result)

    # data = StringIO(result)

    # # 使用read_csv读取
    # data = pd.read_csv(data, header=None, names=['Category', 'Value'])
    # print(data)

    # labels_col = "Category"
    # values_col = "Value"

    # 生成文件名
    if not save_path:
        save_path = os.path.join(FIGURE_DIR, f"pie_chart_{safe_timestamp()}.png")

    # 设置图表字体
    plt.rcParams.update({
        'font.sans-serif': ['WenQuanYi Zen Hei'],
        'axes.unicode_minus': False,
    })
    
    # 创建图表
    plt.figure(figsize=figsize)
    
    # 设置默认颜色
    if colors is None:
        colors = ['#ff9999', '#66b3ff', '#99ff99', '#ffcc99', 
                 '#ff99cc', '#c2c2f0', '#ffb3e6', '#c4e17f']
    
    # 设置默认突出显示
    if explode is None:
        explode = [0.05] * len(data)
    
    # 绘制饼图
    wedges, texts, autotexts = plt.pie(data[values_col], 
                                       labels=data[labels_col] if not legend else None,
                                       colors=colors[:len(data)],
                                       autopct=autopct,
                                       startangle=startangle,
                                       explode=explode[:len(data)],
                                       shadow=shadow)
    
    # 设置标题
    plt.title(title, fontsize=14, pad=20)
    
    # 美化文本
    for autotext in autotexts:
        autotext.set_color('white')
        autotext.set_fontsize(10)
        autotext.set_fontweight('bold')
    
    # 添加图例
    if legend:
        plt.legend(wedges, data[labels_col],
                  title="Categories",
                  loc="center left",
                  bbox_to_anchor=(1, 0, 0.5, 1))
    
    # 确保饼图是圆形
    plt.axis('equal')
    plt.tight_layout()
    
    # 保存图像
    if save_path:
        plt.savefig(save_path, dpi=dpi, bbox_inches='tight')
        print(f"饼状图已保存至: {save_path}")
    
    # 显示图表
    if show:
        plt.show()
    else:
        plt.close()
    
    # return plt.gcf()
    # return ToolResponse(content=[TextBlock(type='text', text=json.dumps({
    #     'status': 'success',
    #     # 'results': results
    #     'img_generation_url': save_path
    # }, ensure_ascii=False))])
    result = f"工具产出的图剖保存路径img_generation_url为：{save_path} 该路径为真实图片路径,严禁引用其他路径"
    return ToolResponse(content=[TextBlock(type='text', text=json.dumps({
        'status': 'success',
        # 'results': results
        "timestamp":str(safe_timestamp()),
        'result':result,
        'img_generation_url': save_path
    }, ensure_ascii=False))])


# ----------------------------
# 对SQL语句规范性进行校验
# ----------------------------
def is_sql_safe(sql: str) -> bool:
    # 危险的 DDL/DML 关键字（只匹配完整单词）
    dangerous_keywords = [
        'delete', 'insert', 'update', 'drop', 'alter',
        'create', 'replace', 'truncate', 'grant', 'revoke'
    ]
    
    # 构建正则：\b 表示单词边界，(?i) 表示忽略大小写
    pattern = r'(?i)\b(?:' + '|'.join(dangerous_keywords) + r')\b'
    
    # 如果找到匹配，说明是危险语句
    if re.search(pattern, sql):
        return False
    return True

class WithOutputStoreSqlExecutor:

    def __init__(self, output_store: dict, print_log: bool = True, caller: str = '调用者'):
        self.output_store = output_store
        self.print_log = print_log
        self.log_id = ''
        self.caller = caller


    # ----------------------------
    # 执行 mySQL 查询并保存为 CSV
    # ----------------------------
    def execute_sql(self, sql) -> ToolResponse:
        """
        检查sql是否包含危险执行语句
        Args:
            sql (str): valid_sql输出的sql
        Returns:
            ToolResponse: 包含数据库查询结果的工具响应对象
        """

        conn = None
        sql_info = {}
        try:
            self.output_store['sql_info'] = sql_info
            sql_info['sql'] = sql
            sql_info['sql_execute_stage'] = 'init'
            sql_info['sql_execute_result'] = None

            # 生成带时间戳的文件名
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            output_file = os.path.join(OUTPUT_DIR, f"high_alert_regions_{timestamp}.csv")
            # 使用 PyMySQL 创建连接（pandas 支持）
            conn = pymysql.connect(**DB_CONFIG)
            print("✅ 成功连接到 MySQL 数据库")

            df = pd.read_sql(sql, conn)
            sql_info['sql_execute_stage'] = 'done'

            if not df.empty:
                df.to_csv(output_file, index=False, encoding='utf-8-sig')
                print(f"✅ 查询成功！共 {len(df)} 行数据已保存至: {os.path.abspath(output_file)}")
                result_data = df.where(pd.notnull(df), None).to_dict(orient='records')
                self.output_store["output"] = result_data
                sql_info['sql_execute_result'] = result_data
                return ToolResponse(
                    content=[
                        TextBlock(
                            type="text",
                            # text=json.dumps({
                            #     "status": "success",
                            #     'result': result_data
                            # }, ensure_ascii=False)
                            text=json.dumps(result_data, ensure_ascii=False) # 解决问题2：返回json
                        )
                    ]
                )
            else:
                self.output_store["output"] = []
                sql_info['sql_execute_result'] = []
                return ToolResponse(
                    content=[
                        TextBlock(
                            type="text",
                            # text=json.dumps({
                            #     "status": "success",
                            #     'result': []
                            # }, ensure_ascii=False)
                            text="查询执行成功，但返回结果为空（0条记录），请向用户说明当前时间范围内无相关数据。" # 解决问题2：返回json
                        )
                    ]
                )

        except Exception as e:
            sql_info['sql_execute_stage'] = 'error'
            error_result = {
                "status": "error",
                "message": f"执行异常: {str(e)}"
            }
            return ToolResponse(
                content=[
                    TextBlock(
                        type="text",
                        text=json.dumps(error_result, ensure_ascii=False)
                    )
                ]
            )
        finally:
            # ✅ 安全关闭连接：检查 conn 是否存在且可关闭
            if conn is not None:
                try:
                    conn.close()
                    print("🔒 数据库连接已关闭")
                except Exception as close_err:
                    print(f"⚠️ 关闭连接时出错: {close_err}")

    def log(self, message):
        if self.print_log:
            print(f'sql_tool_log===> [{self.caller}]<{self.log_id}>: {message}')

    def valid(self, sql):
        valid_sql_status = False
        try:
            # 移除Markdown代码块标记
            sql = re.sub(r'```sql\n|\n```', '', sql)
            sql = re.sub(r'```\n|\n```', '', sql)

            # 移除SQL前缀
            sql = re.sub(r'^SQL:\s*', '', sql, flags=re.IGNORECASE)
            valid_sql_status = True
        except Exception as e:
            valid_sql_status = False
        return valid_sql_status, sql

    def secure(self, sql) -> bool:
        sql_safe_status = False
        try:
            if not is_sql_safe(sql):
                sql_safe_status = False
            else:
                sql_safe_status = True
        except Exception as e:
            sql_safe_status = False
        return sql_safe_status

    def execute(self, sql):
        conn = None
        try:
            # 使用 PyMySQL 创建连接（pandas 支持）
            conn = pymysql.connect(**DB_CONFIG)
            print("✅ 成功连接到 MySQL 数据库")
            df = pd.read_sql(sql, conn)
            return df, None
        except Exception as e:
            return None, e
        finally:
            # ✅ 安全关闭连接：检查 conn 是否存在且可关闭
            if conn is not None:
                try:
                    conn.close()
                    print("🔒 数据库连接已关闭")
                except Exception as close_err:
                    print(f"⚠️ 关闭连接时出错: {close_err}")

    def execute_sql_tool(self, sql) -> ToolResponse:
        """
        执行生成的sql语句的工具
        Args:
            sql (str): 待执行的sql语句
        Returns:
            ToolResponse: 包含数据库查询结果的工具响应对象
        """
        self.log_id = str(uuid.uuid4())
        # self.log('开始执行execute_sql_tool')
        # self.log(f'入参sql:{sql}')

        # self.log(f'步骤valid开始，入参:{sql}')
        valid_sql_status, new_sql = self.valid(sql)
        # self.log(f'步骤valid输出:{valid_sql_status} {new_sql}')
        if not valid_sql_status:
            error_result = {
                "status": "error",
                "message": f"sql语句不规范：{sql}"
            }
            # self.log('结束执行execute_sql_tool')
            return ToolResponse(
                content=[
                    TextBlock(
                        type="text",
                        text=json.dumps(error_result, ensure_ascii=False)
                    )
                ]
            )

        self.log(f'步骤secure开始，入参:{new_sql}')
        secure_result = self.secure(new_sql)
        # self.log(f'步骤secure输出:{secure_result}')
        if not secure_result:
            # 解决问题：sql语句不安全
            # 记录安全检查失败信息到 output_store，便于外层识别
            sql_info = {
                'sql': new_sql,
                'sql_execute_stage': 'security_rejected',
                'sql_execute_result': None,
            }
            self.output_store['sql_info'] = sql_info
            error_result = {
                "status": "error",
                "message": f"【系统限制】本系统仅支持 SELECT 数据查询，不支持 UPDATE、DELETE、INSERT、DROP、ALTER、CREATE、REPLACE、TRUNCATE、GRANT、REVOKE 等任何数据修改操作。请立即停止尝试，直接向用户说明：'当前系统仅支持数据查询，不支持更新、删除或插入等操作。'"
            }
            # self.log('结束执行execute_sql_tool')
            return ToolResponse(
                content=[
                    TextBlock(
                        type="text",
                        text=json.dumps(error_result, ensure_ascii=False)
                    )
                ]
            )


        sql_info = {
            'sql': new_sql,
            'sql_execute_stage': 'init',
            'sql_execute_result': None,
        }
        self.output_store['sql_info'] = sql_info
        # self.log(f'步骤execute开始，入参:{new_sql}')
        df, e = self.execute(new_sql)
        if e:
            error_result = {
                "status": "error",
                "message": f"执行异常: {str(e)}"
            }
            # self.log(f'步骤execute输出: 执行异常-{str(e)}')
            # self.log('结束执行execute_sql_tool')
            return ToolResponse(
                content=[
                    TextBlock(
                        type="text",
                        text=json.dumps(error_result, ensure_ascii=False)
                    )
                ]
            )
        else:
            try:
                # self.log(f'步骤execute输出: 成功')
                # self.log(f'步骤execute结果解析开始')
                # 生成带时间戳的文件名
                timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                output_file = os.path.join(OUTPUT_DIR, f"high_alert_regions_{timestamp}.csv")
                # self.log(f'步骤execute结果解析: 开始写入csv文件-{output_file}')
                df.to_csv(output_file, index=False, encoding='utf-8-sig')
                # self.log(f'步骤execute结果解析: 写入csv文件成功-{output_file}')

                # 将结果集转换为结果列表对象
                # self.log(f'步骤execute结果解析: 开始将结果集转换为json')
                json_data_str = df.to_json(orient='records', date_format='iso')
                # self.log(f'步骤execute结果解析: 将结果集转换为json成功-{json_data_str}')
                # self.log(f'步骤execute结果解析: 开始将结果集json转换为列表对象')
                result_data = json.loads(json_data_str)
                # self.log(f'步骤execute结果解析: 将结果集json转换为列表对象成功-{result_data}')
                sql_info['sql_execute_stage'] = 'done'
                sql_info['sql_execute_result'] = result_data
                # self.log('结束执行execute_sql_tool')
                # 解决问题2：返回json
                if not result_data: # 未跳转进去
                    return ToolResponse(
                        content=[
                            TextBlock(
                                type="text",
                                text="查询执行成功，但返回结果为空（0条记录），请向用户说明当前时间范围内无相关数据。"
                            )
                        ]
                    )
                return ToolResponse(
                    content=[
                        TextBlock(
                            type="text",
                            # text=json.dumps({
                            #     "status": "success",
                            #     'result': result_data
                            # }, ensure_ascii=False)
                            text=json.dumps(result_data, ensure_ascii=False) # 解决问题2：返回json
                        )
                    ]
                )
            except Exception as e:
                traceback.print_exc()
                sql_info['sql_execute_stage'] = 'error'
                error_result = {
                    "status": "error",
                    "message": f"提取查询结果失败: {str(e)}"
                }
                # self.log(f'提取查询结果失败: {str(e)}')
                # self.log('结束执行execute_sql_tool')
                return ToolResponse(
                    content=[
                        TextBlock(
                            type="text",
                            text=json.dumps(error_result, ensure_ascii=False)
                        )
                    ]
                )

# ---------------------------- 查明细 ----------------------------
# ----------------------------
# 创建数据明细查询用户输入重写Agent智能体
# ----------------------------
def create_data_detail_query_rewrite_agent():
    """创建数据明细查询用户输入重写Agent"""

    # 创建工具包
    toolkit = Toolkit()

    model = OpenAIChatModel(
        model_name=MODEL,
        api_key=API_KEY,
        stream=True,  # 启用流式输出
        client_kwargs={
            "base_url": MODEL_SERVER,

            "timeout": 60
        },
        generate_kwargs={
            "temperature": 0.5,
            "top_p": 0.8,
            "max_tokens": 8192
        }
    )

    # 创建内存
    memory = InMemoryMemory()

    # 系统提示词 - 更新为适配多方案架构的新版本
    # 解决问题1：智能体不知道当前时间
    sys_prompt = get_current_date_hint() + sys_prompt_data_detail_query_rewrite

    # 创建格式化器
    formatter = OpenAIChatFormatterWithThinking()

    # 创建ReAct Agent
    agent = ReActAgent(
        name="用户输入重写智能体",
        sys_prompt=sys_prompt,
        model=model,
        formatter=formatter,
        memory=memory,
        toolkit=toolkit,
        parallel_tool_calls=False,
        max_iters=5
    )

    return agent

# ----------------------------
# 创建数据明细查询Agent智能体
# ----------------------------
def create_data_detail_agent():
    """创建数据明细查询Agent"""
    output_store = {}
    with_output_store_sql_executor = WithOutputStoreSqlExecutor(output_store, print_log=True, caller="数据明细查询智能体")
    # 创建工具包
    toolkit = Toolkit()

    # 注册工具函数

    # toolkit.register_tool_function(valid_sql)
    # toolkit.register_tool_function(secure_sql)
    # toolkit.register_tool_function(with_output_store_sql_executor.execute_sql)
    toolkit.register_tool_function(with_output_store_sql_executor.execute_sql_tool)

    # 创建OpenAI聊天模型 - 使用正确的参数结构
    model = OpenAIChatModel(
        model_name=MODEL,
        api_key=API_KEY,
        stream=True,  # 启用流式输出
        client_kwargs={
            "base_url": MODEL_SERVER,

            "timeout": 60
        },
        generate_kwargs={
            "temperature": 0.5,
            "top_p": 0.8,
            "max_tokens": 8192
        }
    )

    # 创建内存
    memory = InMemoryMemory()

    # 系统提示词 - 更新为适配多方案架构的新版本
    # sys_prompt = sys_prompt_data_detail
    # 解决问题1：智能体不知道当前时间
    sys_prompt = get_current_date_hint() + sys_prompt_data_detail_merge_sql_operation

    # 创建格式化器
    formatter = OpenAIChatFormatterWithThinking()

    # 创建ReAct Agent
    agent = ReActAgent(
        name="数据明细查询智能体",
        sys_prompt=sys_prompt,
        model=model,
        formatter=formatter,
        memory=memory,
        toolkit=toolkit,
        parallel_tool_calls=False,
        max_iters=5
    )

    return agent, output_store

# ---------------------------- 主流程 ----------------------------
# ----------------------------
# 创建数据分析Agent智能体
# ----------------------------
def create_data_agent():
    """创建数据分析Agent"""
    output_store = {}
    with_output_store_sql_executor = WithOutputStoreSqlExecutor(output_store, print_log=True, caller="数据分析智能体")
    
    # 创建工具包
    toolkit = Toolkit()
    
    # 注册工具函数

    # toolkit.register_tool_function(valid_sql)
    # toolkit.register_tool_function(secure_sql)
    # # toolkit.register_tool_function(execute_sql)
    # toolkit.register_tool_function(with_output_store_sql_executor.execute_sql)
    toolkit.register_tool_function(with_output_store_sql_executor.execute_sql_tool)


    
    # 创建OpenAI聊天模型 - 使用正确的参数结构
    model = OpenAIChatModel(
        model_name=MODEL,
        api_key=API_KEY,
        stream=True,  # 启用流式输出
        client_kwargs={ 
            "base_url": MODEL_SERVER,
            
            "timeout": 60
        },
        generate_kwargs={
            # "temperature": 0.5,
            # "top_p": 0.8,
            "temperature": 0.3,  # 0.3
            # "top_p": 0.95,
            "max_tokens": 8192,  # 8192
            # "extra_body": {"enable_thinking": False}   # ysq
        }
    )
    
    # 创建内存
    memory = InMemoryMemory()
    
    # 系统提示词 - 更新为适配多方案架构的新版本
    # sys_prompt = sys_prompt_data
    # 解决问题1：智能体不知道当前时间
    sys_prompt = get_current_date_hint() + sys_prompt_data_merge_sql_operation

    # 创建格式化器
    formatter = OpenAIChatFormatterWithThinking()
    
    # 创建ReAct Agent
    agent = ReActAgent(
        name="数据分析智能体",
        sys_prompt=sys_prompt,
        model=model,
        formatter=formatter,
        memory=memory,
        toolkit=toolkit,      
        parallel_tool_calls=False,
        max_iters=3  # 5
    )
    
    return agent, output_store

# ----------------------------
# 创建画图Agent智能体
# ----------------------------
def create_figure_report_agent():
    """创建数据分析Agent"""
    
    # 创建工具包
    toolkit = Toolkit()
    
    # 注册工具函数
    toolkit.register_tool_function(
        create_line_chart,
        json_schema = {
            "type": "function",
            "function": {
                "name": "create_line_chart", 
                "description": "根据输入的数据信息生成折线图",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "data": {
                            "type": "string",
                            "description": "csv格式的绘图数据，示例：'hour_start,event_count\n0,10\n1,20\n2,30'"
                        },
                        "x_col": {
                            "type": "string",
                            "description": "X轴数据列名，必须是data中的列名，示例：'hour_start'"
                        },
                        "y_cols": {
                            "type": "array",
                            "description": "Y轴数据列名列表，可以是一个或多个列名，示例：['event_count']",
                            "items": {
                                "type": "string"
                            },
                            "minItems": 1
                        },
                        "title": {
                            "type": "string",
                            "description": "图表标题",
                            "default": "Line Plot"
                        },
                        "xlabel": {
                            "type": "string",
                            "description": "X轴标签",
                            "default": "X Axis"
                        },
                        "ylabel": {
                            "type": "string",
                            "description": "Y轴标签",
                            "default": "Y Axis"
                        }
                    },
                    "required": ["data", "x_col", "y_cols"]  # 必需参数
                }
            }
        }
    )

    toolkit.register_tool_function(
        create_bar_chart,
        json_schema = {
            "type": "function",
            "function": {
                "name": "create_bar_chart", 
                "description": "根据输入的数据信息生成柱状图",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "data": {
                            "type": "string",
                            "description": "CSV格式的绘图数据，示例：'product,amount\nA,100\nB,200\nC,150'"
                        },
                        "x_col": {
                            "type": "string",
                            "description": "X轴数据列名（分类变量），如产品类别、月份、地区等，示例：'product'"
                        },
                        "y_col": {
                            "type": "string", 
                            "description": "Y轴数据列名（数值变量），如销售额、数量、评分等，示例：'amount'"
                        },
                        "title": {
                            "type": "string",
                            "description": "图表标题",
                            "default": "Bar Chart"
                        },
                        "xlabel": {
                            "type": "string",
                            "description": "X轴标签",
                            "default": "X Axis"
                        },
                        "ylabel": {
                            "type": "string",
                            "description": "Y轴标签",
                            "default": "Y Axis"
                        }
                    },
                    "required": ["data", "x_col", "y_col"]  # 必需参数
                }
            }
        }
    )

    toolkit.register_tool_function(
        create_pie_chart,
        json_schema = {
            "type": "function",
            "function": {
                "name": "create_pie_chart", 
                "description": "根据输入的数据信息生成饼状图",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "data": {
                            "type": "string",
                            "description": "csv格式的绘图数据(标签为第一列，数值为第二列)，示例：'type_label,cnt\n有效告警,72\n误报,152'"
                        },
                        "labels_col": {
                            "type": "string",
                            "description": "标签数据列名，示例：'type_label'"
                        },
                        "values_col": {
                            "type": "string",
                            "description": "数值数据列名，示例：'cnt'"
                        },
                        "title": {
                            "type": "string",
                            "description": "图表标题",
                            "default": "Pie Chart"
                        }
                    },
                    "required": ["data", "labels_col", "values_col"]  # 必需参数
                }
            }
        }
    )
 
    # 创建OpenAI聊天模型 - 使用正确的参数结构
    model = OpenAIChatModel(
        model_name=MODEL,
        api_key=API_KEY,
        stream=True,  # 启用流式输出
        client_kwargs={ 
            "base_url": MODEL_SERVER,
            'http_client':httpx.AsyncClient(verify=False),
            "timeout": 60
        },
        generate_kwargs={
            # "temperature": 0.5,
            # "top_p": 0.8,
            "temperature": 0.3,
            # "top_p": 0.8,
            "max_tokens": 8192,  # 8192
            # "extra_body": {"enable_thinking": False}   # ysq
        }
    )
    
    # 创建内存
    memory = InMemoryMemory()
    
    # 系统提示词 - 更新为适配多方案架构的新版本
    # 解决问题1：智能体不知道当前时间
    sys_prompt = get_current_date_hint() + sys_prompt_figure_report
    
    # 创建格式化器
    formatter = OpenAIChatFormatterWithThinking()
    
    # 创建ReAct Agent
    agent = ReActAgent(
        name="画图与回答撰写智能体",
        sys_prompt=sys_prompt,
        model=model,
        formatter=formatter,
        memory=memory,
        toolkit=toolkit,      
        parallel_tool_calls=False,
        max_iters=2  # 5
    )
    
    return agent



# -------------------------- non-streaming ----------------------------
async def generate_report_data_detail_sync(user_query: str):
    """
    非流式数据明细查询函数，供 generate_report_sync 调用。
    保留智能体改写与查询逻辑，去掉流式输出。

    Args:
        user_query: 用户的查询字符串

    Returns:
        dict: data_detail_agent 的 output_store，包含 sql_info 等信息
    """

    # 1. 创建智能体
    data_detail_query_rewrite_agent = create_data_detail_query_rewrite_agent()
    data_detail_agent, output_store = create_data_detail_agent()
    try:
        # 2. 创建用户消息
        user_msg = Msg(name="用户", content=user_query, role="user")

        # 3. 改写用户输入（非流式，直接等待返回）
        data_detail_query_rewrite_agent.set_console_output_enabled(True)
        rewrite_msg = await data_detail_query_rewrite_agent(user_msg)
        rewrite_result = rewrite_msg.get_text_content() or ""

        print("===> rewrite_result: ", rewrite_result)
        # 判断是否重写成功，改写失败，则流程结束。改写成功，则使用新语句查询。
        new_query = ''
        try:
            if '</think>' in rewrite_result:
                rewrite_result = rewrite_result[rewrite_result.find("</think>") + len('</think>'):]

            json_pattern = re.compile(r'\{.*\}', re.DOTALL)  # re.DOTALL 让 . 匹配包括换行符在内的所有字符
            match = json_pattern.search(rewrite_result)

            if match:
                json_string = match.group()  # 提取匹配到的字符串
                try:
                    parsed_data = json.loads(json_string)
                    new_query = parsed_data['query']
                except json.JSONDecodeError as e:
                    print("提取出的字符串不是有效的JSON:", e)
            else:
                print("未找到类似JSON的结构")
        except Exception as e:
            print(f"警告：无法解析实体消息 JSON {rewrite_result[:100]}...: {e}")
        print("===> new_query: ", new_query)
        if not new_query:
            return None

        new_user_msg = Msg(name="用户", content=new_query, role="user")
        data_detail_agent.set_console_output_enabled(True)

        # 4. 执行数据明细查询（非流式，直接等待返回）
        result_msg = await data_detail_agent(new_user_msg)
        result = result_msg.get_text_content() or ""

        # 生成唯一文件名
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"qa_report_data_detail_{timestamp}.txt"

        filepath = os.path.join(REPORT_DIR, filename)

        # 写入文件
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(result)

        return output_store
    except Exception as e:
        traceback.print_exc()
        return None
    finally:
        # 关闭/清理agent
        await close_agent(data_detail_agent)

async def generate_report_sync(user_query: str) -> str:
    """
    非流式报告生成函数，供 Dify 等外部系统直接调用。
    基于 main() 的串行调用逻辑，保留了 generate_report() 的数据组装与错误处理。
    
    Args:
        user_query: 用户的查询字符串
        
    Returns:
        str: 最终生成的 Markdown 报告内容
    """
    # 拦截自我介绍类问题，直接返回预设回答，不消耗大模型 token
    if is_self_introduction_query(user_query):
        print("[拦截] 检测到自我介绍类问题，直接返回预设回答")
        return SELF_INTRODUCTION_TEXT

    # 拦截与边防数据明显无关的问题
    if is_irrelevant_query(user_query):
        print("[拦截] 检测到无关问题，直接返回预设回答")
        return IRRELEVANT_RESPONSE_TEXT

    data_agent = None
    figure_report_agent = None
    try:
        # 1. 创建智能体
        data_agent, data_agent_output_store = create_data_agent()
        figure_report_agent = create_figure_report_agent()
        print("数据分析多Agent已启动！(同步模式)")

        # 2. 创建用户消息
        user_msg = Msg(name="用户", content=user_query, role="user")

        # 3. 串行调用 data_agent（不流式，直接等待最终返回）
        data_msg = await data_agent(user_msg)
        print('===> data_agent 执行完毕')

        # 4. 获取 SQL 执行信息（SQL语句、执行状态、执行结果）
        report_data_sql = ''
        report_data_sql_execute_stage = ''
        report_data_result = []
        if "sql_info" in data_agent_output_store:
            sql_info = data_agent_output_store["sql_info"]
            report_data_sql = sql_info.get('sql', '')
            report_data_sql_execute_stage = sql_info.get('sql_execute_stage', '')
            report_data_result = sql_info.get('sql_execute_result', [])
            report_data_result = sanitize_query_result(report_data_result, str_placeholder="")

        # 5. SQL 安全检查与失败检查
        if report_data_sql and report_data_sql_execute_stage == 'security_rejected':
            raise ValueError("当前系统仅支持数据查询，不支持更新、删除或插入等操作")
        if report_data_sql and report_data_sql_execute_stage != 'done':
            raise ValueError("查询问答数据失败")

        # data_agent 未执行SQL（如打招呼、无关问题等），直接返回其原始回复，不再调用 figure_report_agent
        if not report_data_sql:
            response_content = data_msg.get_text_content() or "" if data_msg else ""
            result = remove_think_tags(response_content)
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"qa_report_sync_{timestamp}.md"
            filepath = os.path.join(REPORT_DIR, filename)
            with open(filepath, "w", encoding="utf-8") as f:
                f.write(result)
            return result

        # >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
        # 6. 组装 data_msg
        #    有 SQL 数据时，用结构化 JSON 重新组装给 figure_report_agent
        #    无 SQL 时（如打招呼），保留 data_agent 的原始回复
        if QA_REPORT_DATA_DETAIL_STATUS == 'enabled' and report_data_sql and report_data_sql_execute_stage == 'done':
            data_detail_agent_output_store = await generate_report_data_detail_sync(user_query)
            report_data_detail_sql = ''
            report_data_detail_sql_execute_stage = ''
            report_data_detail_result = []
            if data_detail_agent_output_store and "sql_info" in data_detail_agent_output_store:
                sql_info = data_detail_agent_output_store["sql_info"]
                report_data_detail_sql = sql_info.get('sql', '')
                report_data_detail_sql_execute_stage = sql_info.get('sql_execute_stage', '')
                report_data_detail_result = sql_info.get('sql_execute_result', [])
                report_data_detail_result = sanitize_query_result(report_data_detail_result, str_placeholder="")

            if report_data_detail_sql_execute_stage == 'done':
                merge_sql = f"""
    WITH
    report_data AS (
    {report_data_sql.strip().removesuffix(";")}
    ),
    report_detail_data AS (
    {report_data_detail_sql.strip().removesuffix(";")}
    )
    SELECT * FROM report_data LEFT JOIN report_detail_data ON 1 = 0
    UNION
    SELECT * FROM report_data RIGHT JOIN report_detail_data ON 1 = 0;
    """
                merge_query_output_store = {}
                WithOutputStoreSqlExecutor(merge_query_output_store, print_log=True, caller="合并查询程序").execute_sql_tool(merge_sql)
                merge_query_sql = ''
                merge_query_sql_execute_stage = ''
                merge_query_result = []
                if "sql_info" in merge_query_output_store:
                    sql_info = merge_query_output_store["sql_info"]
                    merge_query_sql = sql_info.get('sql', '')
                    merge_query_sql_execute_stage = sql_info.get('sql_execute_stage', '')
                    merge_query_result = sql_info.get('sql_execute_result', [])

                report_data_all = []
                report_data_detail_all = []
                if merge_query_sql_execute_stage != 'done':
                    raise ValueError("合并查询数据失败")
                else:
                    for row in merge_query_result:
                        keys = row.keys()
                        report_data_obj = {}
                        report_data_detail_obj = {}
                        data_detail_type = row.get('data_detail_type', '')
                        if data_detail_type and not pd.isna(data_detail_type):
                            if data_detail_type in ['alarm_event', 'buckle_info', 'sys_dept', 'device']:
                                for key in keys:
                                    if key in ['data_detail_type', 'data_detail_pk', 'data_detail_longitude',
                                               'data_detail_latitude']:
                                        report_data_detail_obj[key.removeprefix('data_detail_')] = None if pd.isna(
                                            row[key]) else row[key]
                                report_data_detail_all.append(report_data_detail_obj)
                        else:
                            for key in keys:
                                if not key in ['data_detail_type', 'data_detail_pk', 'data_detail_longitude',
                                               'data_detail_latitude']:
                                    report_data_obj[key] = None if pd.isna(row[key]) else row[key]
                            report_data_all.append(report_data_obj)
                    report_data_detail_all = sanitize_query_result(report_data_detail_all, str_placeholder="")
                    report_data_all = sanitize_query_result(report_data_all, str_placeholder="")
                print('===> 时空数据：', report_data_detail_all)
                print('===> 问答数据：', report_data_all)

                data_content = f'''
    用户输入： {user_query}
    实际执行的SQL：{report_data_sql}
    获取到的数据：
    ```json
    {json.dumps(report_data_all, ensure_ascii=False)}
    ```
    '''
                data_msg = Msg(name="user", content=data_content, role="user")
            else:
                print('===> 问答数据：', report_data_result)
                data_content = f'''
用户输入： {user_query}
实际执行的SQL：{report_data_sql}
获取到的数据：
```json
{json.dumps(report_data_result, ensure_ascii=False)}
```
'''
                data_msg = Msg(name="user", content=data_content, role="user")
        
        # >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
        
        elif report_data_sql:
            data_content = f'''
用户输入： {user_query}
实际执行的SQL：{report_data_sql}
获取到的数据：
```json
{json.dumps(report_data_result, ensure_ascii=False)}
```
'''
            data_msg = Msg(name="user", content=data_content, role="user")

        # 7. 串行调用 figure_report_agent（不流式，直接等待最终返回）
        print("===> data_msg: ", data_msg)
        report_msg = await figure_report_agent(data_msg)
        response_content = report_msg.get_text_content() or "" if report_msg else ""
        print("===> figure_report_agent 执行完毕")

        # 8. 清洗思考标签并保存文件
        result = remove_think_tags(response_content)

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"qa_report_sync_{timestamp}.md"
        filepath = os.path.join(REPORT_DIR, filename)
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(result)

        return result

    except Exception as e:
        traceback.print_exc()
        raise e
    
    finally:
        # 9. 显式关闭 Agent，防止内存泄漏
        if data_agent is not None:
            await close_agent(data_agent)
        if figure_report_agent is not None:
            await close_agent(figure_report_agent)

# ----------------------------------------------------------------


async def main() -> None:
    """Run a multi-agent conversation workflow."""


    data_agent,_ =create_data_agent()
    figure_report_agent=create_figure_report_agent()
    print("🚁 数据分析多Agent已启动！")
    print("=" * 50)
    print("\n🎯 示例指令：")
    print("  1月以来，告警率最高的是哪个位置？请提供经纬度。")
    print("  2026年1月13日告警事件的高发时段是哪三个小时？")
    
    print("\n🚪 输入 'exit' 退出程序")
    print("=" * 50)
    print()
     
    # 创建用户代理用于交互
    user = UserAgent("系统")
    
    msg = None
    while True:
        # 获取用户输入
        msg = await user(msg)
        
        # 检查退出条件
        if msg.get_text_content() == "exit":
            print("感谢使用数据分析多Agent，再见！")
            break
        
        # 运行agent并获取响应
        data_msg = await data_agent(msg)
        print('打印data_agent')
        await data_agent.print(data_msg)
        print('打印data_agent结束')
        report_msg = await figure_report_agent(data_msg)
        print('figure_report_agent')
        await figure_report_agent.print(report_msg)
        print('figure_report_agent结束')

        response_content = report_msg.get_text_content() if report_msg else ""

        result = remove_think_tags(response_content)

        # 生成唯一文件名
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"qa_report_{timestamp}.md"

        filepath = os.path.join(REPORT_DIR, filename)
        
        # 写入文件
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(result)



# -------------------------- streaming ------------------------------ 
async def generate_report_data_detail(stream_id: str, user_query: str):
    """
    生成自定义报告的函数，供 FastAPI 调用

    Args:
        user_query: 用户的查询字符串

    Returns:
        dict: 包含状态、消息、报告内容和报告路径的字典
    """

    # 处理逻辑
    #   - 对用户的输入进行改写
    #   - 使用改写后的语句进行查询

    # 1. 创建智能体
    data_detail_query_rewrite_agent=create_data_detail_query_rewrite_agent()
    data_detail_agent, output_store=create_data_detail_agent()
    try:
        # 2. 创建用户消息
        user_msg = Msg(name="用户", content=user_query, role="user")

        # 3. 改写用户输入
        data_detail_query_rewrite_agent.set_console_output_enabled(True)
        # data_detail_query_rewrite = await data_detail_query_rewrite_agent(user_msg)
        # rewrite_result = data_detail_query_rewrite.get_text_content()

        rewrite_result = ''
        last_content = {"value":""}
        pre_type = new_pre_type()
        async for resp, last in stream_printing_messages(
            agents=[data_detail_query_rewrite_agent],
            coroutine_task=data_detail_query_rewrite_agent(user_msg),
        ):
            # print(resp, last)

            # 收集完整内容
            if last:
                rewrite_result = resp.get_text_content()
            await _stream_hook(data_detail_query_rewrite_agent, resp, last, pre_type, last_content, stream_id, is_display_text=False)

        print("===> rewrite_result: ", rewrite_result)
        # 判断是否重写成功，改成失败，则流程结束。改成成功，则使用新语句查询。
        new_query = ''
        try:
            if '</think>' in rewrite_result:
                rewrite_result = rewrite_result[rewrite_result.find("</think>") + len('</think>'):]

            json_pattern = re.compile(r'\{.*\}', re.DOTALL)  # re.DOTALL 让 . 匹配包括换行符在内的所有字符
            match = json_pattern.search(rewrite_result)

            if match:
                json_string = match.group()  # 提取匹配到的字符串
                try:
                    parsed_data = json.loads(json_string)
                    new_query = parsed_data['query']
                except json.JSONDecodeError as e:
                    print("提取出的字符串不是有效的JSON:", e)
            else:
                print("未找到类似JSON的结构")
        except Exception as e:
            print(f"警告：无法解析实体消息 JSON {rewrite_result[:100]}...: {e}")
        print("===> new_query: ", new_query)
        if not new_query:
            return None

        new_user_msg = Msg(name="用户", content=new_query, role="user")
        data_detail_agent.set_console_output_enabled(True)
        # data_detail = await data_detail_agent(new_user_msg)
        # result = data_detail.get_text_content()


        result = ''
        last_content = {"value":""}
        pre_type = new_pre_type()
        async for resp, last in stream_printing_messages(
            agents=[data_detail_agent],
            coroutine_task=data_detail_agent(new_user_msg),
        ):
            # print(resp, last)

            # 收集完整内容
            if last:
                result = resp.get_text_content()
            await _stream_hook(data_detail_agent, resp, last, pre_type, last_content, stream_id, is_display_text=False)

        # 生成唯一文件名
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"qa_report_data_detail_{timestamp}.txt"

        filepath = os.path.join(REPORT_DIR, filename)

        # 写入文件
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(result)

        # print("===> output_store: ", output_store)
        return output_store
    except Exception as e:
        await stream_message(stream_id, {
            "type": "error",
            "content": f"Agent处理失败：{str(e)}"
        })
        return None
    finally:
        # await stream_message(stream_id, {
        #     "type": "over",
        #     "content": "✅ 查询信息明细完毕！"
        # })
        # 关闭/清理agent
        await close_agent(data_detail_agent)

# 处理完整文本 20260519
# async def generate_report_data(stream_id: str, user_query: str) -> dict:
#     """
#     生成自定义报告的函数，供 FastAPI 调用

#     Args:
#         user_query: 用户的查询字符串

#     Returns:
#         dict: 包含状态、消息、报告内容和报告路径的字典
#     """


#     try:
#         # 1. 创建智能体
#         data_agent, _ = create_data_agent()
#         figure_report_agent=create_figure_report_agent()
#         print("数据分析多Agent已启动！")

#         # 2. 创建用户消息
#         user_msg = Msg(name="用户", content=user_query, role="user")

#         # 3. 串行智能体工作流
#         ## 用户问题 → data_agent → 结构化数据；
#         ## 结构化数据 → figure_report_agent → 可视化报告。
#         ## 所有智能体间通信通过 Msg 对象传递
#         # data_msg = await data_agent(user_msg)

#         # 收集流式输出的同时获得完整内容
#         data_msg = ()

#         data_agent.set_console_output_enabled(False)

#         last_content = {"value":""}
#         pre_type = new_pre_type()
#         async for resp, last in stream_printing_messages(
#             agents=[data_agent],
#             coroutine_task=data_agent(user_msg),
#         ):
#             # print(resp, last)

#             # 收集完整内容
#             if last:
#                 data_msg = resp
#             await _stream_hook(data_agent, resp, last, pre_type, last_content, stream_id, is_display_text=False)

#         # report_msg = await figure_report_agent(data_msg)  # Agent间通信
#         # print("===> data_msg: ", data_msg)
#         response_content = ""

#         figure_report_agent.set_console_output_enabled(False)

#         last_content = {"value":""}
#         pre_type = new_pre_type()
#         async for resp, last in stream_printing_messages(
#             agents=[figure_report_agent],
#             coroutine_task=figure_report_agent(data_msg),
#         ):
#             # print(resp, last)

#             if last:
#                 response_content = resp.get_text_content() or ""
#             await _stream_hook(figure_report_agent, resp, last, pre_type, last_content, stream_id)

#         # response_content = report_msg.get_text_content() if report_msg else ""

#         result = remove_think_tags(response_content)

#         # 生成唯一文件名
#         timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
#         filename = f"qa_report_{timestamp}.md"

#         filepath = os.path.join(REPORT_DIR, filename)

#         # 写入文件
#         with open(filepath, "w", encoding="utf-8") as f:
#             f.write(result)

#     except Exception as e:
#         # return f"Agent处理失败：{str(e)}"
#         # result = {
#         #     "status": "error",
#         #     "text": f"Agent处理失败：{str(e)}",
#         # }
#         # return result

#         await stream_message(stream_id, {
#             "type": "error",
#             "content": f"Agent处理失败：{str(e)}"
#         })
#     finally:
#         await stream_message(stream_id, {
#             "type": "over",
#             "content": "✅ 回答完毕！"
#         })
#         # 关闭/清理agent
#         await close_agent(data_agent)
#         await close_agent(figure_report_agent)



async def generate_report(stream_id: str, user_query: str) -> dict:
    """
    生成自定义报告的函数，供 FastAPI 调用

    Args:
        user_query: 用户的查询字符串

    Returns:
        dict: 包含状态、消息、报告内容和报告路径的字典
    """

    # ----------------------- 解决问题：自我介绍和无关问题 ------------------------
    # 拦截自我介绍类问题，直接推送预设回答，不消耗大模型 token
    if is_self_introduction_query(user_query):
        print("[拦截] 检测到自我介绍类问题，直接返回预设回答")
        # await stream_message(stream_id, {
        #     "type": "text",
        #     "content": SELF_INTRODUCTION_TEXT
        # })
        await stream_text(stream_id, SELF_INTRODUCTION_TEXT)
        await stream_message(stream_id, {
            "type": "over",
            "content": "✅ 回答完毕！"
        })
        await stream_message(stream_id, None)
        return {"status": "success", "report_content": SELF_INTRODUCTION_TEXT}

    # 拦截与边防数据明显无关的问题
    if is_irrelevant_query(user_query):
        print("[拦截] 检测到无关问题，直接返回预设回答")
        # await stream_message(stream_id, {
        #     "type": "text",
        #     "content": IRRELEVANT_RESPONSE_TEXT
        # })
        await stream_text(stream_id, IRRELEVANT_RESPONSE_TEXT)
        await stream_message(stream_id, {
            "type": "over",
            "content": "✅ 回答完毕！"
        })
        await stream_message(stream_id, None)
        return {"status": "success", "report_content": IRRELEVANT_RESPONSE_TEXT}
    # ---------------------------------------------------------------------------

    try:
        # 1. 创建智能体
        data_agent, data_agent_output_store=create_data_agent()
        figure_report_agent=create_figure_report_agent()
        print("数据分析多Agent已启动！")

        # 2. 创建用户消息
        user_msg = Msg(name="用户", content=user_query, role="user")

        # 3. 串行智能体工作流
        ## 用户问题 → data_agent → 结构化数据；
        ## 结构化数据 → figure_report_agent → 可视化报告。
        ## 所有智能体间通信通过 Msg 对象传递
        # data_msg = await data_agent(user_msg)

        # 收集流式输出的同时获得完整内容
        data_msg = ()

        data_agent.set_console_output_enabled(True)

        last_content = {"value":""}
        pre_type = new_pre_type()
        async for resp, last in stream_printing_messages(
            agents=[data_agent],
            coroutine_task=data_agent(user_msg),
        ):
            # print(resp, last)

            # 收集完整内容
            if last:
                data_msg = resp
            await _stream_hook(data_agent, resp, last, pre_type, last_content, stream_id, is_display_text=False)

        # <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<
        # 问答的数据查询智能体执行完成后，获取其执行的sql信息
        report_data_sql = ''
        report_data_sql_execute_stage = ''
        report_data_result = []
        if "sql_info" in data_agent_output_store: # 智能体已执行execute_sql工具
            sql_info = data_agent_output_store["sql_info"]
            report_data_sql = sql_info.get('sql', '')
            report_data_sql_execute_stage = sql_info.get('sql_execute_stage', '')
            report_data_result = sql_info.get('sql_execute_result', [])
            report_data_result = sanitize_query_result(report_data_result, str_placeholder="")
        # >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>

        # <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<
        # 问答的数据查询智能体执行完成后，执行sql失败时结束处理
        # 解决问题：sql语句不安全
        if report_data_sql and report_data_sql_execute_stage == 'security_rejected':
            raise ValueError("当前系统仅支持数据查询，不支持更新、删除或插入等操作")
        if report_data_sql and report_data_sql_execute_stage != 'done':
            raise ValueError("查询问答数据失败")
        # >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>

        # data_agent 未执行SQL（如打招呼、无关问题等），直接返回其原始回复，不再调用 figure_report_agent
        if not report_data_sql:
            response_content = data_msg.get_text_content() or "" if data_msg else ""
            result = remove_think_tags(response_content)
            # await stream_message(stream_id, {
            #     "type": "text",
            #     "content": result
            # })
            await stream_text(stream_id, result)
            await stream_message(stream_id, {
                "type": "over",
                "content": "✅ 回答完毕！"
            })
            await stream_message(stream_id, None)
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"qa_report_{timestamp}.md"
            filepath = os.path.join(REPORT_DIR, filename)
            with open(filepath, "w", encoding="utf-8") as f:
                f.write(result)
            return {"status": "success", "report_content": result}

        if QA_REPORT_DATA_DETAIL_STATUS == 'enabled' and report_data_sql and report_data_sql_execute_stage == 'done':
            # <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<
            # 改写用户输入后查询时空数据，获取其执行的sql信息
            data_detail_agent_output_store = await generate_report_data_detail(stream_id, user_query)
            report_data_detail_sql = ''
            report_data_detail_sql_execute_stage = ''
            report_data_detail_result = []
            if "sql_info" in data_detail_agent_output_store: # 智能体已执行execute_sql工具
                sql_info = data_detail_agent_output_store["sql_info"]
                report_data_detail_sql = sql_info.get('sql', '')
                report_data_detail_sql_execute_stage = sql_info.get('sql_execute_stage', '')
                report_data_detail_result = sql_info.get('sql_execute_result', [])
                report_data_detail_result = sanitize_query_result(report_data_detail_result, str_placeholder="")
            # >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>

            # <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<
            if report_data_detail_sql_execute_stage == 'done':
                # 时空数据查询智能体执行完成后，执行sql成功
                # 合并问答数据查询sql和时空数据查询sql
                merge_sql = f"""
    WITH
    report_data AS (
    {report_data_sql.strip().removesuffix(";")}
    ),
    report_detail_data AS (
    {report_data_detail_sql.strip().removesuffix(";")}
    )
    SELECT * FROM report_data LEFT JOIN report_detail_data ON 1 = 0
    UNION
    SELECT * FROM report_data RIGHT JOIN report_detail_data ON 1 = 0;
    """
                merge_query_output_store = {}
                WithOutputStoreSqlExecutor(merge_query_output_store, print_log=True, caller="合并查询程序").execute_sql_tool(merge_sql)
                merge_query_sql = ''
                merge_query_sql_execute_stage = ''
                merge_query_result = []
                if "sql_info" in merge_query_output_store:  # 智能体已执行execute_sql工具
                    sql_info = merge_query_output_store["sql_info"]
                    merge_query_sql = sql_info.get('sql', '')
                    merge_query_sql_execute_stage = sql_info.get('sql_execute_stage', '')
                    merge_query_result = sql_info.get('sql_execute_result', [])

                # 解析合并sql查询，提取问答数据和时空数据
                report_data_all = []
                report_data_detail_all = []
                if merge_query_sql_execute_stage != 'done':
                    raise ValueError("合并查询数据失败")
                else:
                    # 解析数据
                    for row in merge_query_result:
                        # print(row)
                        keys = row.keys()
                        report_data_obj = {}
                        report_data_detail_obj = {}
                        data_detail_type = row.get('data_detail_type', '')
                        if data_detail_type and not pd.isna(data_detail_type):
                            if data_detail_type in ['alarm_event', 'buckle_info', 'sys_dept', 'device']:
                                for key in keys:
                                    if key in ['data_detail_type', 'data_detail_pk', 'data_detail_longitude',
                                               'data_detail_latitude']:
                                        report_data_detail_obj[key.removeprefix('data_detail_')] = None if pd.isna(
                                            row[key]) else row[key]
                                report_data_detail_all.append(report_data_detail_obj)
                        else:
                            for key in keys:
                                if not key in ['data_detail_type', 'data_detail_pk', 'data_detail_longitude',
                                               'data_detail_latitude']:
                                    report_data_obj[key] = None if pd.isna(row[key]) else row[key]
                            report_data_all.append(report_data_obj)
                    report_data_detail_all = sanitize_query_result(report_data_detail_all, str_placeholder="")
                    report_data_all = sanitize_query_result(report_data_all, str_placeholder="")
                print('===> 时空数据：', report_data_detail_all)
                print('===> 问答数据：', report_data_all)
                # 响应时空数据
                await stream_message(stream_id, {
                    "type": "data_detail",
                    "content": report_data_detail_all
                })

                # 组织问答数据
                # data_msg = Msg(name="assistant", content = json.dumps(report_data_all, ensure_ascii=False), role="assistant")

                data_content = f'''
    用户输入： {user_query}
    实际执行的SQL：{report_data_sql}
    获取到的数据：
    ```json
    {json.dumps(report_data_all, ensure_ascii=False)}
    ```
    '''
                # data_msg = Msg(name="assistant", content = data_content, role="assistant")  # 0415 ysq
                data_msg = Msg(name="user", content=data_content, role="user")
            else:
                # 时空数据查询智能体执行完成后，执行sql失败，使用数据分析智能体的查询结果作为问答数据
                print('===> 问答数据：', report_data_result)
                # 组织问答数据
                # data_msg = Msg(name="assistant", content = json.dumps(report_data_result, ensure_ascii=False), role="assistant")

                data_content = f'''
用户输入： {user_query}
实际执行的SQL：{report_data_sql}
获取到的数据：
```json
{json.dumps(report_data_result, ensure_ascii=False)}
```
'''
                # data_msg = Msg(name="assistant", content = data_content, role="assistant") # 0415 ysq
                data_msg = Msg(name="user", content=data_content, role="user")

        # >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
        else:
            # 没有执行SQL时（如打招呼），保留data_agent的原始回复，不覆盖data_msg
            if report_data_sql:
                # 时空数据查询智能体执行完成后，执行sql失败，使用数据分析智能体的查询结果作为问答数据
                print('===> 问答数据：', report_data_result)
                # 组织问答数据
                # data_msg = Msg(name="assistant", content = json.dumps(report_data_result, ensure_ascii=False), role="assistant")

                data_content = f'''
用户输入： {user_query}
实际执行的SQL：{report_data_sql}
获取到的数据：
```json
{json.dumps(report_data_result, ensure_ascii=False)}
```
'''
                # data_msg = Msg(name="assistant", content=data_content, role="assistant")  # 0415 ysq
                data_msg = Msg(name="user", content=data_content, role="user")
        # report_msg = await figure_report_agent(data_msg)  # Agent间通信
        print("===> data_msg: ", data_msg)
        response_content = ""

        figure_report_agent.set_console_output_enabled(False)

        last_content = {"value":""}
        pre_type = new_pre_type()
        async for resp, last in stream_printing_messages(
            agents=[figure_report_agent],
            coroutine_task=figure_report_agent(data_msg),
        ):
            # print(resp, last)

            if last:
                response_content = resp.get_text_content() or ""
            await _stream_hook(figure_report_agent, resp, last, pre_type, last_content, stream_id)

        # response_content = report_msg.get_text_content() if report_msg else ""

        result = remove_think_tags(response_content)

        # 生成唯一文件名
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"qa_report_{timestamp}.md"

        filepath = os.path.join(REPORT_DIR, filename)

        # 写入文件
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(result)

    except Exception as e:
        # return f"Agent处理失败：{str(e)}"
        # result = {
        #     "status": "error",
        #     "text": f"Agent处理失败：{str(e)}",
        # }
        # return result
        traceback.print_exc()

        await stream_message(stream_id, {
            "type": "error",
            "content": f"Agent处理失败：{str(e)}"
        })
    finally:
        await stream_message(stream_id, {
            "type": "over",
            "content": "✅ 回答完毕！"
        })
        #结束响应
        await stream_message(stream_id, None)
        # 关闭/清理agent
        await close_agent(data_agent)
        await close_agent(figure_report_agent)

# ----------------------------------------------------------------



# ==================== 调试入口 ====================
if __name__ == "__main__":
    # asyncio.run(main())
    """
    调试入口说明：
    1. generate_report_sync: 非流式调试，直接返回 Markdown 字符串
    2. generate_report: 流式调试，模拟 SSE 调用，会生成 .md 文件并打印控制台日志
    3. main: 交互式命令行模式（原有功能）
    
    使用方式：
      python -m qa.agent_qa 1    # 调试 generate_report (流式)
      python -m qa.agent_qa 2    # 调试 generate_report_sync (非流式)
      python -m qa.agent_qa 3    # 运行交互式 main()
      python -m qa.agent_qa      # 默认调试 generate_report_sync (模式2)
    """
    import sys

    # # 批量测试查询列表（可自由添加/修改）
    TEST_QUERIES = [
        "统计3月以来各级预警的数量，按预警等级降序排列",
        # "3月20日上午8点到10点之间产生了多少条预警？",
        # "查询所有“枪机”设备产生的一级预警数量。",
        # "统计今年每个月的白名单、黑名单、陌生人的通行次数。",
        # "上个月处理时长最长的5条预警是哪些？",
        # "最近3天，人员动作为“翻越”或“跑跳”的预警有多少个？",
        # "有哪些预警还没有被处理？显示预警编号、设备名称和预警时间。",
        # "哪个设备产生的预警最少？给出最少的3个设备。",
    ]

    # TEST_QUERIES = [
    #     "a4纸是什么？",
    #     "你是谁？你能做什么？",
    #     "统计所有预警的“预警颜色”。",
    #     "查一下预警。",
    #     "查询1970年的预警数量。",
    #     "帮我看看最近一周，那些烦人的一级预警总共有多少个？",
        # "把事件编号为“AL2026001”的预警等级改成二级。",
    #     "写一个SQL，统计每个大门的进出总人次。",
    #     "最近有多少预警？",
    #     "列出所有进入大门时匹配结果为“拒绝”的人员姓名和联系方式。",
    # ]



    async def debug_generate_report():
        """调试流式 generate_report 函数（批量测试）"""
        print("=" * 60)
        print("【模式1】调试 generate_report (流式批量测试)")
        print("=" * 60)
        print(f"共 {len(TEST_QUERIES)} 条测试查询")
        print("-" * 60)
        print("提示：流式函数会推送 SSE 消息到队列，但此处无前端消费。")
        print("      控制台日志和 .md 文件仍会正常生成。\n")

        results = []
        for idx, query in enumerate(TEST_QUERIES, 1):
            test_stream_id = f"debug_stream_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{idx}"
            print(f"\n{'=' * 60}")
            print(f"[{idx}/{len(TEST_QUERIES)}]")
            print(f"stream_id : {test_stream_id}")
            print(f"user_query: {query}")
            print(f"{'=' * 60}\n")

            result = await generate_report(test_stream_id, query)
            results.append(result)
            print(f"\n{'-' * 60}")
            print(f"【{idx}】处理完成")
            print(f"{'-' * 60}")

        print("\n" + "=" * 60)
        print("generate_report 批量调试结束")
        print("=" * 60)
        return results

    async def debug_generate_report_sync():
        """调试非流式 generate_report_sync 函数（批量测试）"""
        print("=" * 60)
        print("【模式2】调试 generate_report_sync (非流式批量测试)")
        print("=" * 60)
        print(f"共 {len(TEST_QUERIES)} 条测试查询")
        print("-" * 60 + "\n")

        results = []
        for idx, query in enumerate(TEST_QUERIES, 1):
            print(f"\n{'=' * 60}")
            print(f"[{idx}/{len(TEST_QUERIES)}]")
            print(f"user_query: {query}")
            print(f"{'=' * 60}\n")

            result = await generate_report_sync(query)
            results.append(result)

            print(f"\n{'-' * 60}")
            print(f"【{idx}】返回内容长度: {len(result)} 字符")
            print(f"前 800 字符预览:\n{'-' * 60}\n{result[:800]}\n{'-' * 60}")

        print("\n" + "=" * 60)
        print("generate_report_sync 批量调试结束")
        print("=" * 60)
        return results

    # # 解析命令行参数或交互式选择
    # if len(sys.argv) > 1:
    #     mode = sys.argv[1].strip()
    # else:
    #     print("\n" + "=" * 60)
    #     print("QA Agent 调试入口")
    #     print("=" * 60)
    #     print("  1 - generate_report      (流式批量测试，生成 .md 文件)")
    #     print("  2 - generate_report_sync (非流式批量测试，直接返回字符串)")
    #     print("  3 - main                 (交互式命令行)")
    #     print("-" * 60)
    #     print(f"默认测试查询 ({len(TEST_QUERIES)} 条):")
    #     for idx, query in enumerate(TEST_QUERIES, 1):
    #         print(f"  [{idx}] {query}")
    #     print("-" * 60)
    #     print("直接回车默认选择模式 2 (generate_report_sync)")
    #     mode = input("请输入模式编号 (1/2/3): ").strip() or "2"

    # if mode == "1":
    #     asyncio.run(debug_generate_report())
    # elif mode == "2":
    #     asyncio.run(debug_generate_report_sync())
    # elif mode == "3":
    #     asyncio.run(main())
    # else:
    #     print(f"未知模式: '{mode}'，默认执行模式 2 (generate_report_sync)")
    #     asyncio.run(debug_generate_report_sync())
    
    asyncio.run(debug_generate_report_sync())
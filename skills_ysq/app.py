
import io
import os
import re
from datetime import datetime
from typing import Literal, Optional

# FastAPI 相关导入
from contextlib import asynccontextmanager
from fastapi import Body, FastAPI, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger   # 新增导入


from custom.wt_defence_agent_custom_v3 import event_generator as custom_report
from daily.daily_report_agent import generate_report as daily_report
from daily.daily_report_agent import generate_report_sync as daily_report_sync
from qa.agent_qa import generate_report as intelligent_qa
from qa.agent_qa import generate_report_sync as intelligent_qa_sync

from config import FIGURE_DIR, OUTPUT_DIR, REPORT_DIR, RETAIN_DAYS

from utils.stream_output import stream_generator, event_manager
from utils.md_to_docx import md_to_docx

import uuid
import asyncio

# 创建文件目录
os.makedirs(FIGURE_DIR, exist_ok=True)
os.makedirs(OUTPUT_DIR, exist_ok=True)
os.makedirs(REPORT_DIR, exist_ok=True)

# 定义请求体模型（规范参数格式）
class MDToDocxRequest(BaseModel):
    md_str: str

class ReportRequest(BaseModel):
    """报告生成请求模型"""
    query: str

class DailyReportRequest(BaseModel):
    """报告生成请求模型"""
    query: str
    # 新增字段：可选 报告类型，如 "all", "buckle", "event"
    report_type: Optional[Literal["all", "buckle", "event"]] = "all"

class FigureRequest(BaseModel):
    """图片生成请求模型"""
    filename: str
    filepath: Optional[str] = None

class ReportResponse(BaseModel):
    """报告生成响应模型"""
    status: str
    message: Optional[str] = None
    report_content: Optional[str] = None
    report_path: Optional[str] = None

# ==================== FastAPI 应用 ====================

def clean_old_files():
    """
    清理超过 RETAIN_DAYS 天的文件
    """
    delete_dir = [FIGURE_DIR, OUTPUT_DIR, REPORT_DIR]
    total_deleted_count = 0
    
    # 循环处理删除目录文件
    for target_dir in delete_dir:
        # 检查目录是否存在
        if not os.path.exists(target_dir):
            print(f"目录不存在，跳过: {target_dir}")
            continue
            
        print(f"开始清理目录: {target_dir}")
        deleted_count = 0
        
        for root, dirs, files in os.walk(target_dir):
            for file in files:
                file_path = os.path.join(root, file)
                try:
                    file_created_time = os.path.getctime(file_path)
                    
                    # 获取当前时间和RETAIN_DAYS天前的时间戳
                    import time
                    now = time.time()
                    cutoff_time = now - (int(RETAIN_DAYS) * 24 * 60 * 60) 
                    
                    # 如果文件创建时间早于截止时间，则删除文件
                    if file_created_time < cutoff_time:
                        os.remove(file_path)
                        print(f"已删除过期文件: {file_path}")
                        deleted_count += 1
                        
                except Exception as e:
                    print(f"处理文件 {file_path} 时出错: {e}")
        
        print(f"目录 {target_dir} 清理完成，删除了 {deleted_count} 个文件")
        total_deleted_count += deleted_count

    print(f"清理完成，共删除 {total_deleted_count} 个文件")

# 使用 lifespan 管理调度器的启动和关闭
@asynccontextmanager
async def lifespan(app: FastAPI):
    # 启动时创建调度器并添加任务
    # 配置调度器，使用线程池执行器，并设置守护线程
    scheduler = BackgroundScheduler(
        executors={
            'default': {'type': 'threadpool', 'max_workers': 10}
        },
        job_defaults={
            'coalesce': False,
            'max_instances': 1
        }
    )
    
    # 添加定时任务
    scheduler.add_job(
        clean_old_files,
        trigger=CronTrigger(hour=0, minute=0),   # 每天0点执行
        id="clean_old_files",
        replace_existing=True,
        # 关键：设置为守护线程，避免阻塞应用退出
        kwargs={},
        misfire_grace_time=300
    )
    
    # 启动调度器
    scheduler.start()
    print("定时清理任务已启动")
    
    # 保持调度器活跃（关键：防止被垃圾回收）
    app.state.scheduler = scheduler
    
    yield
    
    # 关闭时停止调度器
    if app.state.scheduler.running:
        app.state.scheduler.shutdown(wait=False)
    print("定时清理任务已停止")


# 创建 FastAPI 应用
app = FastAPI(title="报告生成API", version="1.0.0", lifespan=lifespan)

# 添加 CORS 中间件
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 允许所有来源，生产环境建议指定具体域名
    allow_credentials=True,
    allow_methods=["*"],  # 允许所有 HTTP 方法
    allow_headers=["*"],  # 允许所有请求头
)

#------------------------- Customized ---------------------------------
@app.post("/customized-report")
async def generate_customized_report(request: ReportRequest):
    """
    生成自定义报告接口
    
    Args:
        request: 包含用户查询的请求对象
        
    Returns:
        ReportResponse: 包含报告生成结果的响应对象
    """
    # 验证查询内容
    user_query = request.query.strip()
    if not user_query:
        raise HTTPException(status_code=400, detail="查询内容不能为空")
    
    stream_id = str(uuid.uuid4())
    try:
        queue = event_manager.create_queue(stream_id)
        # 在后台启动任务
        asyncio.create_task(custom_report(stream_id, user_query))
        return StreamingResponse(stream_generator(stream_id, queue), media_type="text/event-stream")
    except Exception as e:
        print(f"[全局错误] {str(e)}")
        return {"error": f"Failed to process request: {str(e)}"}, 500

#------------------------- Daily ----------------------------------------
def validate_date_format(date_str: str) -> bool:
    """
    验证字符串是否符合 "%Y-%m-%d" 格式
    :param date_str: 待验证的日期字符串
    :return: True(格式正确) / False(格式错误)
    """
    # 正则表达式匹配年-月-日格式
    pattern = r'^\d{4}-\d{2}-\d{2}$'
    if not re.match(pattern, date_str):
        return False
    
    # 尝试解析日期，验证有效性
    try:
        datetime.strptime(date_str, "%Y-%m-%d")
        return True
    except ValueError:
        return False

@app.post("/daily-report")
async def generate_daily_report(request: DailyReportRequest):
    """
    生成每日报告接口

    Args:
        request: 用户指定的时间（格式为'2025-12-10'）
        
    Returns:
        ReportResponse: 包含报告生成结果的响应对象
    """

    """验证参数格式正确性"""

    user_date = request.query.strip()
    report_type = request.report_type.strip() # 新增字段：报告类型，如 "all", "buckle", "event"
    
    # 处理日期：若为空则使用当前日期
    if not user_date:
        user_date = datetime.now().strftime("%Y-%m-%d")
    else:
        res = validate_date_format(user_date)
        if not res:
            raise HTTPException(status_code=400, detail="请输入合法时间，格式为'2025-12-10'")
    
    # 校验 report_type 合法性（强烈建议）
    valid_types = {"all", "buckle", "event"}
    if report_type not in valid_types:
        raise HTTPException(
            status_code=400,
            detail=f"report_type 必须是以下之一: {', '.join(valid_types)}"
        )
    
    #流式输出
    stream_id = str(uuid.uuid4())
    try:
        queue = event_manager.create_queue(stream_id)
        # 在后台启动任务
        asyncio.create_task(daily_report(stream_id, user_date, report_type))
        return StreamingResponse(stream_generator(stream_id, queue), media_type="text/event-stream")
    except Exception as e:
        print(f"[全局错误] {str(e)}")
        return {"error": f"Failed to process request: {str(e)}"}, 500

    #---------------------------- Daily 直接串行调用（不经过流式队列）----------------------------
@app.post("/daily-report-direct")
async def generate_daily_report_direct(request: DailyReportRequest):
    """
    日报生成非流式接口（直接串行调用 Agent，供 Dify 使用）
    与 /daily-report 逻辑一致，但采用 await agent() 串行调用，不经过 SSE 流式队列。
    请求参数与 /daily-report 完全一致，返回普通 JSON。
    """
    user_date = request.query.strip()
    report_type = request.report_type.strip()

    if not user_date:
        user_date = datetime.now().strftime("%Y-%m-%d")
    else:
        if not validate_date_format(user_date):
            raise HTTPException(status_code=400, detail="请输入合法时间，格式为'2025-12-10'")

    valid_types = {"all", "buckle", "event"}
    if report_type not in valid_types:
        raise HTTPException(
            status_code=400,
            detail=f"report_type 必须是以下之一: {', '.join(valid_types)}"
        )

    try:
        report_content = await daily_report_sync(user_date, report_type)
        return {
            "status": "success",
            "date": user_date,
            "report_type": report_type,
            "report_content": report_content
        }
    except Exception as e:
        print(f"[日报直接接口错误] {str(e)}")
        raise HTTPException(status_code=500, detail=f"Agent处理失败：{str(e)}")


#----------------------- QA ---------------------------------------------
@app.post("/intelligent-QA")
async def generate_customized_report(request: ReportRequest):
    """
    QA接口
    
    Args:
        request: 包含用户查询的请求对象
        
    Returns:
        ReportResponse: 包含报告生成结果的响应对象
    """
    # 验证查询内容
    user_query = request.query.strip()
    if not user_query:
        raise HTTPException(status_code=400, detail="查询内容不能为空")
    
    stream_id = str(uuid.uuid4())
    try:
        queue = event_manager.create_queue(stream_id)
        # 在后台启动任务
        asyncio.create_task(intelligent_qa(stream_id, user_query))
        return StreamingResponse(stream_generator(stream_id, queue), media_type="text/event-stream")
    except Exception as e:
        print(f"[全局错误] {str(e)}")
        return {"error": f"Failed to process request: {str(e)}"}, 500

    #---------------------------- for dify ------------------------------
@app.post("/intelligent-QA-direct")
async def generate_intelligent_qa_direct(request: ReportRequest):
    """
    智能问答非流式接口（直接串行调用 Agent，供 Dify 使用）
    与 /intelligent-QA 逻辑一致，但采用 await agent() 串行调用，不经过 SSE 流式队列。
    请求参数与 /intelligent-QA 完全一致，返回普通 JSON。
    """
    user_query = request.query.strip()
    if not user_query:
        raise HTTPException(status_code=400, detail="查询内容不能为空")

    try:
        report_content = await intelligent_qa_sync(user_query)
        return {
            "status": "success",
            "query": user_query,
            "report_content": report_content
        }
    except Exception as e:
        print(f"[智能问答直接接口错误] {str(e)}")
        raise HTTPException(status_code=500, detail=f"Agent处理失败：{str(e)}")

#------------------------------------------------------------------------


@app.get("/figure/{filename}")
async def get_figure(filename: str):
    """获取图表文件"""
    file_path = os.path.join(FIGURE_DIR, filename)
    if os.path.exists(file_path):
        return FileResponse(file_path)
    else:
        raise HTTPException(status_code=500, detail="文件不存在")

@app.post("/md-to-docx")
async def convert_md_to_docx(
    request: MDToDocxRequest = Body(...)
):
    """
    将传入的Markdown字符串转换为Word (.docx) 文档并返回下载（支持中文）
    前置依赖：
    1. 系统级：apt install pandoc (Linux) / 下载安装pandoc（Windows/Mac）
    2. Python包：uv pip install pypandoc
    """
    # 校验输入
    md_str = request.md_str.strip()
    if not md_str:
        raise HTTPException(status_code=500, detail="Markdown字符串不能为空")
    
    try:
        # 返回流式响应（确保文件名中文正常显示）
        mem_stream = io.BytesIO()
        mem_stream.write(md_to_docx(md_str))
        mem_stream.seek(0)
        
        # 处理文件名的中文编码（兼容HTTP头）
        header_filename = f"cover.docx".encode("utf-8")
        return StreamingResponse(
            mem_stream,
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers={
                # 核心：双格式文件名，兼容新旧浏览器
                "Content-Disposition": f'attachment; filename="{header_filename}"',
                "Content-Type":  'application/octet-stream',
                # 禁用缓存，避免浏览器复用旧文件
                "Cache-Control": "no-store, no-cache, must-revalidate",
                "Pragma": "no-cache"
            }
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"转换失败：{str(e)}")

@app.get("/")
async def root():
    """根路径，返回 API 信息"""
    return {
        "message": "自定义报告生成API",
        "version": "1.0.0",
        "endpoints": {
            "POST /customized-report": "生成自定义报告"
        }
    }


@app.get("/health")
async def health_check():
    """健康检查接口"""
    return {"status": "healthy"}

def main():
    port = int(os.environ.get("PORT", 18020))
    # 启动 FastAPI 应用
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=port)

if __name__ == '__main__':
    main()
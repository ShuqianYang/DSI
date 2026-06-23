"""兼容 thinking block 的 OpenAI Chat Formatter。

AgentScope 的 OpenAIChatFormatter 在格式化对话历史时，遇到 type 为
thinking 的 content block 会打印 warning 并跳过。这是因为 OpenAI API
不支持在输入消息中携带 reasoning_content。

本 formatter 在格式化前自动过滤掉 thinking block，避免 warning，同时
不影响正常的 text / tool_use / tool_result / image 等 block。
"""

import copy
from typing import Any

from agentscope.formatter import OpenAIChatFormatter
from agentscope.message import Msg


class OpenAIChatFormatterWithThinking(OpenAIChatFormatter):
    """OpenAI Chat Formatter，自动忽略 thinking block。"""

    async def format(
        self,
        msgs: list[Msg],
        **kwargs: Any,
    ) -> list[dict[str, Any]]:
        """格式化消息，过滤 thinking block 后再交给父类处理。"""
        # 浅拷贝消息列表，避免修改原始列表
        filtered_msgs = []
        for msg in msgs:
            # 如果 content 是包含 thinking block 的列表，则过滤掉 thinking
            if isinstance(msg.content, list):
                new_content = [
                    block
                    for block in msg.content
                    if not (
                        isinstance(block, dict)
                        and block.get("type") == "thinking"
                    )
                ]
                # 使用 copy.copy 复制消息并替换 content，避免修改原消息
                new_msg = copy.copy(msg)
                new_msg.content = new_content
                filtered_msgs.append(new_msg)
            else:
                filtered_msgs.append(msg)

        return await super().format(filtered_msgs, **kwargs)

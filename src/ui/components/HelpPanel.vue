<template>
  <div class="mneme-tab-body">
    <div class="mneme-section-title">使用说明</div>

    <h3 class="mneme-help-title">Mneme 是什么</h3>
    <p class="mneme-entry-body">
      一个卷宗式记忆插件。每轮对话结束后，模型会在回复末尾附带一小段结构化记忆，插件把它收进账本并从正文中隐去；下一次生成前，再把相关记忆注入提示词。
    </p>

    <h3 class="mneme-help-title">四个模块</h3>
    <p class="mneme-entry-body">
      <b>记忆</b>：每条 AI 回复一条摘要；满 10 条自动封卷成册。<br />
      <b>羁绊</b>：好感度、角色对 user 的印象、重要事件。<br />
      <b>道具</b>：获得的物品、来源与作用。<br />
      <b>剧情线</b>：解析角色卡与世界书得到的一条折叠时间轴，默认只给模型「当前节点」。
    </p>

    <h3 class="mneme-help-title">常见问题</h3>
    <p class="mneme-entry-body">
      <b>模型没有输出记忆怎么办？</b><br />
      面板会给出提示。可在「记忆」标签手动补录；正文不会受任何影响。<br /><br />
      <b>剧情线什么时候生成？</b><br />
      默认关闭。可在设置里开启「新聊天自动生成」，或在「剧情线」标签手动点「重新解析时间轴」。<br /><br />
      <b>记忆存在哪里？</b><br />
      存在当前聊天的元数据里，导出聊天时一并带走；换聊天互不影响。<br /><br />
      <b>会不会剧透？</b><br />
      时间轴在面板里默认折叠；注入给模型的默认只有「当前节点」，并附带禁止说破的约束。<br /><br />
      <b>删了消息会怎样？</b><br />
      插件按正文指纹重新对齐：还存在的消息保留记忆，被删掉的条目连同其羁绊事件一起移除。
    </p>
  </div>
</template>

<script setup lang="ts"></script>

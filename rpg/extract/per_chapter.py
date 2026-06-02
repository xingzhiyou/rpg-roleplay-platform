"""extract/per_chapter.py — Pass 1 逐章固定-schema 三元组提取。

discover-then-link 的 link:带 已发现词表 + 钉死纪元种子 读每章 → 固定 schema JSON。
直接修"concepts 98% 空"(关键词匹配空,LLM 强制填字段);纪元钉死 → 不再幻觉 1935。
设计 docs/design/A_extraction.md §4。
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

from extract.llm import ExtractLLM

# 每章输出 JSON schema(给模型看的契约)
# v28: entities 加 identity / background,与玩家 PC 角色卡字段对齐 → 同套 schema 渲染
# P0 大改:entities 加 subtype + parent — 解决"德军/国防军/铁人团/无忧宫/毛瑟厂"
# 全标 faction 平级问题。LLM 抽取时按下面 subtype 枚举打标 + 报告归属上级。
_SUBTYPE_HINT = """
subtype = 此实体在【本作世界观】中扮演什么角色的【自然语言短标签】(2-6 字,中文/英文皆可)。
**允许自创**,只要标签能反映 entity 的功能层级。优先用文本里出现过的称呼;实在没有再用通用词。

各 type 的常见标签参考(**不限定枚举**):
  · character: 留空(角色卡有更细的 identity/background)
  · faction: 取该团体的【组织形态】
      军事政治题材:国家、军队、军团、军种、部队、政府、议会、机构、政党
      仙侠/武侠题材:宗门、门派、修真世家、长老堂、护法堂、武林盟、散修组织
      奇幻/西幻题材:王国、城邦、骑士团、教会、教派、公会、商会、佣兵团、部落
      现代/科幻题材:公司、部门、工作室、学院、班级、社团、实验室、殖民地、联邦
      校园/职场:学院、社团、班级、部门、项目组
      末世/克苏鲁:邪教、异教、秘密组织、议会、研究所
      跨题材兜底:组织、团体、势力、家族、宗族、流派
  · location: 取地点的【尺度+性质】
      region(大区/国家)、city、town、village、landmark(地标)、building(建筑)、
      仙侠:洞天、福地、秘境、宗门、山门、城池
      奇幻:王宫、城堡、塔、营地、神殿
      现代:总部、基地、办公楼、街区、酒店
  · concept: 取概念的【性质】
      ideology(思想/主义)、power_system(力量体系/修炼体系)、technology(科技/装备类目)、
      culture(普世文化/习俗;**绝不抽某角色"穿着X/拿着Y"这种章节场景**)、
      artifact_type(法宝/神器类目)、rule(规则/法则)、phenomenon(现象/天象)
  · item: 通常不填(具体物品级别太细,优先抽 concept.technology / concept.artifact_type)

**重要**:不要硬塞英文枚举值;按【小说语境】生成最贴切的中文短标签。例:
  · 玄幻文里"剑山十二宗" → subtype="宗门集合体" 比 subtype="faction" 准确
  · 校园文里"星海祭执行委员会" → subtype="社团委员会" 比 "agency" 准确
"""
_PARENT_HINT = """
parent 字段:本实体归属的上级实体名(本章已揭示的):
  · 铁人团.parent = "德军" 或 "国防军"(若文本里有此关系)
  · 德军.parent = "德国"
  · 无忧宫.parent = "德国"(德国总统官邸)
  · 毛瑟厂.parent = "德国"
  · 第22军.parent = "美华共和国"
**只在本章明确可见的归属时填,不要编造**。本章没揭示父级 → 留空。
"""
_SCHEMA_HINT = """{
  "chapter_summary": "本章主线 1-3 句话浓缩(>=30 字 <=150 字),含核心冲突/转折/谁做了什么。绝不照抄原文,绝不堆细节。",
  "story_time": {"label": "本章故事时间(短语)", "relative_marker": "相对上章的时序线索", "era": "<纪元,必须照抄给定纪元,严禁改写>"},
  "entities": [{
    "surface": "文中称呼",
    "full_name": "本人最完整的正式名(欧美名 = 名+姓全套,如 Mulelia Zazbarum;若文中已知则填写,否则同 surface)",
    "canonical_guess": "规范名(优先匹配已知实体)",
    "aliases_in_chapter": ["本章用到的其他称呼/昵称/半名/译名(如 ['Mulelia','小蕾'])"],
    "identity": "≤40字身份定位/职位/阵营(如:北境蜂巢主管/异端审判庭检察官/林家二少爷;非 character 类留空)",
    "background": "≤120字本章可见前史摘要(此实体出场前的关键经历或当下处境/出身/动机;只抽本章直接揭露或暗示的,不要编造;非 character 类留空)",
    "type": "character|faction|organization|location|item|concept",
    "subtype": "<按 type 选,见下方 SUBTYPE_HINT;character 留空>",
    "parent": "<本实体归属的上级实体名;本章没揭示父级则空;见 PARENT_HINT>",
    "status": "linked|proposed",
    "evidence": "≤20字依据"
  }],
  "events": [{"summary": "事件一句话", "participants": ["实体名"], "location": "地点", "importance": 0-100, "causal_refs": ["前置事件描述"]}],
  "relationships": [{"from": "实体A", "to": "实体B", "kind": "敌对|盟友|上下级|亲属|...", "evidence": "≤20字"}],
  "concepts": [{"name": "概念/设定/力量体系名", "gloss": "≤30字解释", "evidence": "≤20字"}],
  "confidence": 0.0-1.0
}"""


@dataclass
class ChapterExtract:
    chapter: int
    chapter_summary: str = ""
    story_time: dict = field(default_factory=dict)
    entities: list = field(default_factory=list)
    events: list = field(default_factory=list)
    relationships: list = field(default_factory=list)
    concepts: list = field(default_factory=list)
    confidence: float = 0.0
    raw_ok: bool = True


def build_system(era: str, power_system: list[str] | None = None) -> str:
    ps = ("、".join(power_system)) if power_system else "(未提供,自行从文中发现)"
    # era 空(未定)→ 放开让 LLM 自抽供共识;非空 → 铁律照抄(防 LLM 用真实历史年份覆盖)
    if not era.strip():
        era_rule = (
            "【纪元自抽】本作纪元未定。story_time.era 字段请按本章文本里出现的最具体纪年/年代填"
            "(如 '1930 年代' / '星历 2930'),若文本无明显纪年指示则填空字符串。后续会跨章共识确定真纪元。"
        )
    else:
        era_rule = (
            f"【纪元铁律】本作纪元固定为:「{era}」。story_time.era 字段必须**原样照抄**此纪元,"
            "**绝对禁止**根据剧情(如二战、年份数字)推断或改写成别的纪元(如 1935、1940)。违反即错误。"
        )
    return (
        "你是小说世界观结构化提取器。读一章正文,**只输出一个 JSON 对象**(无任何解释/前后语)。\n"
        + era_rule + "\n"
        f"【力量体系参考】{ps}(文中出现就抽进 concepts,可发现新的)。\n"
        "【提取要求】entities 优先匹配下方已知实体词表(status=linked),文中新出现的标 proposed;"
        "concepts 必须尽量抽全(力量体系/组织设定/专有名词/世界规则),不要留空;"
        "events 给本章局部 importance(0-100),不要做跨章全局排序。\n"
        "【欧美人名铁律】凡角色为欧美名(包含字母或音译,如 Mulelia/林菲尔德/伊莎贝拉·路德维希):full_name **必须** 是"
        "正式的全套姓+名(若本章用 'Mulelia' 但作者之前已揭示她叫 'Mulelia Zazbarum',则 full_name 写完整全名);"
        "本章里出现的所有别称(昵称/半名/敬称/外号/译名)塞进 aliases_in_chapter。**严禁** 把全名和昵称当作两个实体输出。\n"
        "【角色卡字段铁律】entity.type=character 时,identity / background 两个字段必须抽:\n"
        "  identity = 此角色在本作世界里的身份/职位/阵营定位(尽量短,不重复 name)\n"
        "  background = 角色出场前的关键经历 / 当下处境 / 出身或动机摘要(只抽本章可观察到或明确暗示的,严禁编造文本没有的设定)\n"
        "  本章不揭示则字段留空字符串,不要写 '未知' 或 'N/A'。type ≠ character 的实体两个字段必须留空。\n"
        "【层级铁律(P0 大改)】faction / location / concept 必须填 subtype + 尝试填 parent:\n"
        "  subtype:按下方 SUBTYPE_HINT 选枚举值,不要乱写。\n"
        "  parent:本实体的上级归属(本章已揭示的;铁人团→德军、德军→德国、无忧宫→德国);**严禁编造**。\n"
        "  同义合并:'德军' 和 '国防军' 是同一军队的两个称呼 → 用一个 entity + aliases_in_chapter 含另一个,**不要拆成两个**。\n"
        + _SUBTYPE_HINT + _PARENT_HINT +
        "【场景污染铁律】concept.culture 必须是普世概念(如'和服 = 瀛洲传统服饰');"
        "严禁把'某角色穿着和服'这种章节场景写成 concept summary。如果只看到角色穿/拿/用,**不要抽**此 concept,等普世描述出现时再抽。\n"
        "严格按此 schema 输出:\n" + _SCHEMA_HINT
    )


def build_user(chapter_text: str, *, known_entities: list[str] | None = None,
               prev_summary: str = "", title_descriptor: str = "") -> str:
    parts = []
    if known_entities:
        parts.append("【已知实体词表(优先 link)】" + "、".join(known_entities[:80]))
    if prev_summary:
        parts.append("【上一章梗概(仅供时序连续,勿照抄)】" + prev_summary[:200])
    if title_descriptor:
        parts.append("【本章内容提示】" + title_descriptor)
    # 控制长度(便宜模型上下文 + 成本):截到 ~6000 字
    body = chapter_text.strip()
    if len(body) > 6000:
        body = body[:6000] + "…(后略)"
    parts.append("【本章正文】\n" + body)
    return "\n\n".join(parts)


def extract_chapter(llm: ExtractLLM, chapter_num: int, chapter_text: str, *, era: str,
                    power_system: list[str] | None = None, known_entities: list[str] | None = None,
                    prev_summary: str = "", title_descriptor: str = "",
                    max_tokens: int = 4500) -> ChapterExtract:
    # 默认 4500:v28 schema 再加 entity.identity (≤40 字) / background (≤120 字) 后,
    # 每个 character entity 多 ~60 token;10+ 角色密集章实测吃满 3500 会再次截尾。
    # 原历史:chapter_summary + full_name/aliases_in_chapter 已把基线从 2000 抬到 3500。
    system = build_system(era, power_system)
    user = build_user(chapter_text, known_entities=known_entities,
                      prev_summary=prev_summary, title_descriptor=title_descriptor)
    try:
        data = llm.complete_json(system, user, max_tokens=max_tokens)
    except Exception:
        return ChapterExtract(chapter=chapter_num, raw_ok=False)
    if not isinstance(data, dict):
        return ChapterExtract(chapter=chapter_num, raw_ok=False)
    st = data.get("story_time") or {}
    # era 已定(非空)→ 铁律回写;era 空 → 让 LLM 自抽,供后续共识
    if isinstance(st, dict) and era.strip():
        st["era"] = era
    return ChapterExtract(
        chapter=chapter_num,
        chapter_summary=str(data.get("chapter_summary") or "")[:400],
        story_time=st if isinstance(st, dict) else {"era": era},
        entities=[e for e in (data.get("entities") or []) if isinstance(e, dict)],
        events=[e for e in (data.get("events") or []) if isinstance(e, dict)],
        relationships=[r for r in (data.get("relationships") or []) if isinstance(r, dict)],
        concepts=[c for c in (data.get("concepts") or []) if isinstance(c, dict)],
        confidence=float(data.get("confidence") or 0.0),
    )


def to_chapter_facts_row(ex: ChapterExtract, *, title: str = "") -> dict[str, Any]:
    """转成现有 chapter_facts 表的列形状(复用表,值来自 LLM 三元组而非关键词)。"""
    return {
        "chapter": ex.chapter,
        "title": title,
        "story_time_label": (ex.story_time or {}).get("label", ""),
        "story_phase": "",
        "characters": [e for e in ex.entities if e.get("type") == "character"],
        "locations": [e for e in ex.entities if e.get("type") == "location"],
        "factions": [e for e in ex.entities if e.get("type") == "faction"],
        "concepts": ex.concepts,
        "items": [e for e in ex.entities if e.get("type") == "item"],
        "relationships": ex.relationships,
        "events": ex.events,
        "confidence": ex.confidence,
        "metadata": {"era": (ex.story_time or {}).get("era", ""), "extractor": "llm_pass1"},
    }


def dumps(ex: ChapterExtract) -> str:
    return json.dumps(to_chapter_facts_row(ex), ensure_ascii=False, indent=2)

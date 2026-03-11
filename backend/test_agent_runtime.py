import asyncio

from agents.base import BaseAgent
from agents.bus import InMemoryAgentBus
from agents.contracts import AgentExecutionResult, AgentTask
from agents.moderator_agent import ModeratorAgent
from agents.registry import AgentRegistry


class StubAgent(BaseAgent):
    def __init__(self, name: str, responses: dict[str, dict]):
        super().__init__(name=name, capabilities=list(responses.keys()))
        self._responses = responses

    async def execute_task(self, task: AgentTask) -> AgentExecutionResult:
        return AgentExecutionResult(
            agent=self.name,
            task_id=task.task_id,
            data=self._responses[task.task_type],
        )


def test_moderator_orchestrates_extraction_workflow():
    registry = AgentRegistry()
    bus = InMemoryAgentBus(registry)
    moderator = ModeratorAgent(bus)

    registry.register(
        StubAgent(
            "media",
            {
                "extract_document": {
                    "metadata": {"title": "Paper"},
                    "data": [{"material_name": "Au", "ionic_liquid": "[BMIM][PF6]", "cof": "0.12"}],
                    "extraction_summary": {"final_count": 1, "dropped_by_reason": {}},
                }
            },
        )
    )
    registry.register(
        StubAgent(
            "query",
            {
                "validate_extraction": {
                    "record_count": 1,
                    "quality_gate_passed": True,
                    "warnings": [],
                }
            },
        )
    )
    registry.register(
        StubAgent(
            "insight",
            {
                "summarize_extraction": {
                    "title": "Paper",
                    "record_count": 1,
                    "top_materials": [{"name": "Au", "count": 1}],
                }
            },
        )
    )
    registry.register(moderator)

    result = asyncio.run(
        moderator.handle_task(AgentTask(task_type="orchestrate_extraction", payload={"file_id": 1}))
    )

    assert result.data["metadata"]["title"] == "Paper"
    assert result.data["agent_workflow"]["validation"]["quality_gate_passed"] is True
    assert len(result.data["agent_workflow"]["messages"]) == 6


def test_moderator_forwards_search_to_query_agent():
    registry = AgentRegistry()
    bus = InMemoryAgentBus(registry)
    moderator = ModeratorAgent(bus)

    registry.register(
        StubAgent(
            "query",
            {
                "search_records": {
                    "total": 2,
                    "skip": 0,
                    "limit": 20,
                    "items": [{"id": 1}, {"id": 2}],
                }
            },
        )
    )
    registry.register(moderator)

    result = asyncio.run(
        moderator.handle_task(AgentTask(task_type="orchestrate_search", payload={"filter_params": object()}))
    )

    assert result.data["total"] == 2
    assert len(bus.get_history(result.task_id)) == 2

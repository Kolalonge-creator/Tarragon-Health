from typing import Annotated, Literal

from pydantic import BaseModel, Field

from .diabetes import HbA1cTrajectoryRequest, HbA1cTrajectoryResponse
from .hypertension import BpControlRequest, BpControlResponse
from .risk import Score2Request, Score2Response

MAX_BATCH_SIZE = 200


class BatchCvdItem(BaseModel):
    type: Literal["cvd"] = "cvd"
    request_id: str = Field(
        min_length=1, description="Caller-supplied correlation id, echoed back."
    )
    payload: Score2Request


class BatchHbA1cItem(BaseModel):
    type: Literal["hba1c"] = "hba1c"
    request_id: str = Field(min_length=1)
    payload: HbA1cTrajectoryRequest


class BatchBpControlItem(BaseModel):
    type: Literal["bp_control"] = "bp_control"
    request_id: str = Field(min_length=1)
    payload: BpControlRequest


BatchItem = Annotated[
    BatchCvdItem | BatchHbA1cItem | BatchBpControlItem, Field(discriminator="type")
]


class BatchPredictionRequest(BaseModel):
    items: list[BatchItem] = Field(min_length=1, max_length=MAX_BATCH_SIZE)


class BatchItemResult(BaseModel):
    request_id: str
    type: Literal["cvd", "hba1c", "bp_control"]
    ok: bool
    result: Score2Response | HbA1cTrajectoryResponse | BpControlResponse | None = None
    error: str | None = None


class BatchPredictionResponse(BaseModel):
    results: list[BatchItemResult]

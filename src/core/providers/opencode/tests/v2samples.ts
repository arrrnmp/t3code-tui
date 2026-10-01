/**
 * Real samples captured from a live OpenCode v2.0.19 server (`GET /api/event`
 * and `GET /api/session/{id}/message`), trimmed: `durable`, `location` and
 * `id` envelope fields dropped, reasoning deltas cut to two. Used to test the
 * v2 → internal translation against what the server really sends.
 */

/** One turn that runs `echo probe-ok` in the shell and answers: enqueued → … → `session.execution.succeeded`. */
export const SHELL_TURN_EVENTS: ReadonlyArray<Record<string, unknown>> = [
  {
    "created": 1790768867423,
    "type": "session.inbox.enqueued",
    "data": {
      "inboxID": "msg_6f89c3f0317c3TtJp3TRZuOMpO",
      "sessionID": "ses_f0ddba907ffeHoSABAb2zhuSrx",
      "item": {
        "type": "user",
        "payload": {
          "text": "Use the shell tool to run exactly: echo probe-ok. Then reply with one short sentence."
        },
        "delivery": "steer"
      }
    }
  },
  {
    "created": 1790768867425,
    "type": "session.execution.started",
    "data": {
      "sessionID": "ses_f0ddba907ffeHoSABAb2zhuSrx"
    }
  },
  {
    "created": 1790768867437,
    "type": "session.inbox.delivered",
    "data": {
      "sessionID": "ses_f0ddba907ffeHoSABAb2zhuSrx",
      "inboxID": "msg_6f89c3f0317c3TtJp3TRZuOMpO"
    }
  },
  {
    "created": 1790768869762,
    "type": "session.step.started",
    "data": {
      "sessionID": "ses_f0ddba907ffeHoSABAb2zhuSrx",
      "agent": "build",
      "model": {
        "id": "longcat-2.5-preview-free",
        "providerID": "opencode"
      },
      "assistantMessageID": "msg_0f22468710012E153TICA4JL4d",
      "started": 1790768867474
    }
  },
  {
    "created": 1790768869764,
    "type": "session.reasoning.started",
    "data": {
      "sessionID": "ses_f0ddba907ffeHoSABAb2zhuSrx",
      "assistantMessageID": "msg_0f22468710012E153TICA4JL4d",
      "ordinal": 0,
      "state": {
        "reasoningField": "reasoning_content"
      }
    }
  },
  {
    "created": 1790768869867,
    "type": "session.reasoning.delta",
    "data": {
      "sessionID": "ses_f0ddba907ffeHoSABAb2zhuSrx",
      "assistantMessageID": "msg_0f22468710012E153TICA4JL4d",
      "ordinal": 0,
      "delta": "\n"
    }
  },
  {
    "created": 1790768870633,
    "type": "session.tool.input.started",
    "data": {
      "sessionID": "ses_f0ddba907ffeHoSABAb2zhuSrx",
      "assistantMessageID": "msg_0f22468710012E153TICA4JL4d",
      "id": "call_b89aee2d3ba0488fa39560cd",
      "name": "shell"
    }
  },
  {
    "created": 1790768871266,
    "type": "session.reasoning.ended",
    "data": {
      "sessionID": "ses_f0ddba907ffeHoSABAb2zhuSrx",
      "assistantMessageID": "msg_0f22468710012E153TICA4JL4d",
      "ordinal": 0,
      "text": "\nThe user wants me to run a simple shell command and then reply with one short sentence. This is straightforward - no need for skills or complex tooling.",
      "state": {
        "reasoningField": "reasoning_content"
      }
    }
  },
  {
    "created": 1790768871269,
    "type": "session.tool.input.ended",
    "data": {
      "sessionID": "ses_f0ddba907ffeHoSABAb2zhuSrx",
      "assistantMessageID": "msg_0f22468710012E153TICA4JL4d",
      "id": "call_b89aee2d3ba0488fa39560cd",
      "text": "{\"command\": \"echo probe-ok\"}"
    }
  },
  {
    "created": 1790768871270,
    "type": "session.tool.called",
    "data": {
      "sessionID": "ses_f0ddba907ffeHoSABAb2zhuSrx",
      "assistantMessageID": "msg_0f22468710012E153TICA4JL4d",
      "id": "call_b89aee2d3ba0488fa39560cd",
      "input": {
        "command": "echo probe-ok"
      },
      "executed": false
    }
  },
  {
    "created": 1790768871289,
    "type": "permission.asked",
    "data": {
      "id": "per_0f2247778001tngDfYafZ62Aag",
      "sessionID": "ses_f0ddba907ffeHoSABAb2zhuSrx",
      "action": "shell",
      "resources": [
        "echo probe-ok"
      ],
      "save": [
        "echo *"
      ],
      "source": {
        "type": "tool",
        "messageID": "msg_0f22468710012E153TICA4JL4d",
        "id": "call_b89aee2d3ba0488fa39560cd"
      }
    }
  },
  {
    "created": 1790768895778,
    "type": "permission.replied",
    "data": {
      "sessionID": "ses_f0ddba907ffeHoSABAb2zhuSrx",
      "requestID": "per_0f2247778001tngDfYafZ62Aag",
      "reply": "once"
    }
  },
  {
    "created": 1790768895780,
    "type": "shell.created",
    "data": {
      "info": {
        "id": "sh_0f224d722002EKmQANgk9fOCcR",
        "status": "running",
        "command": "echo probe-ok",
        "cwd": "/tmp/ocv2/work",
        "shell": "/bin/zsh",
        "file": "/Users/aaron/.local/share/opencode/shell/global/sh_0f224d722002EKmQANgk9fOCcR.out",
        "metadata": {
          "sessionID": "ses_f0ddba907ffeHoSABAb2zhuSrx"
        },
        "time": {
          "started": 1790768895778
        }
      }
    }
  },
  {
    "created": 1790768895780,
    "type": "session.tool.progress",
    "data": {
      "sessionID": "ses_f0ddba907ffeHoSABAb2zhuSrx",
      "assistantMessageID": "msg_0f22468710012E153TICA4JL4d",
      "id": "call_b89aee2d3ba0488fa39560cd",
      "metadata": {
        "shellID": "sh_0f224d722002EKmQANgk9fOCcR"
      }
    }
  },
  {
    "created": 1790768895783,
    "type": "shell.exited",
    "data": {
      "id": "sh_0f224d722002EKmQANgk9fOCcR",
      "exit": 0,
      "status": "exited"
    }
  },
  {
    "created": 1790768895784,
    "type": "session.tool.success",
    "data": {
      "sessionID": "ses_f0ddba907ffeHoSABAb2zhuSrx",
      "assistantMessageID": "msg_0f22468710012E153TICA4JL4d",
      "id": "call_b89aee2d3ba0488fa39560cd",
      "content": [
        {
          "type": "text",
          "text": "probe-ok\n"
        }
      ],
      "metadata": {
        "status": "completed",
        "truncated": false,
        "exit": 0
      },
      "executed": false
    }
  },
  {
    "created": 1790768895785,
    "type": "session.step.ended",
    "data": {
      "sessionID": "ses_f0ddba907ffeHoSABAb2zhuSrx",
      "assistantMessageID": "msg_0f22468710012E153TICA4JL4d",
      "finish": "tool-calls",
      "rawFinish": "tool_calls",
      "cost": 0,
      "tokens": {
        "input": 3028,
        "output": 19,
        "reasoning": 32,
        "cache": {
          "read": 5632,
          "write": 0
        }
      }
    }
  },
  {
    "created": 1790768895786,
    "type": "session.usage.updated",
    "data": {
      "sessionID": "ses_f0ddba907ffeHoSABAb2zhuSrx",
      "cost": 0,
      "tokens": {
        "input": 3028,
        "output": 19,
        "reasoning": 32,
        "cache": {
          "read": 5632,
          "write": 0
        }
      }
    }
  },
  {
    "created": 1790768898168,
    "type": "session.step.started",
    "data": {
      "sessionID": "ses_f0ddba907ffeHoSABAb2zhuSrx",
      "agent": "build",
      "model": {
        "id": "longcat-2.5-preview-free",
        "providerID": "opencode"
      },
      "assistantMessageID": "msg_0f224d72f001fI8DzJWxhAWqYl",
      "started": 1790768895795
    }
  },
  {
    "created": 1790768898171,
    "type": "session.reasoning.started",
    "data": {
      "sessionID": "ses_f0ddba907ffeHoSABAb2zhuSrx",
      "assistantMessageID": "msg_0f224d72f001fI8DzJWxhAWqYl",
      "ordinal": 0,
      "state": {
        "reasoningField": "reasoning_content"
      }
    }
  },
  {
    "created": 1790768898661,
    "type": "session.text.started",
    "data": {
      "sessionID": "ses_f0ddba907ffeHoSABAb2zhuSrx",
      "assistantMessageID": "msg_0f224d72f001fI8DzJWxhAWqYl",
      "ordinal": 0
    }
  },
  {
    "created": 1790768898764,
    "type": "session.text.delta",
    "data": {
      "sessionID": "ses_f0ddba907ffeHoSABAb2zhuSrx",
      "assistantMessageID": "msg_0f224d72f001fI8DzJWxhAWqYl",
      "ordinal": 0,
      "delta": "The shell command executed successfully"
    }
  },
  {
    "created": 1790768898876,
    "type": "session.text.delta",
    "data": {
      "sessionID": "ses_f0ddba907ffeHoSABAb2zhuSrx",
      "assistantMessageID": "msg_0f224d72f001fI8DzJWxhAWqYl",
      "ordinal": 0,
      "delta": " and printed `probe-ok`."
    }
  },
  {
    "created": 1790768898885,
    "type": "session.reasoning.ended",
    "data": {
      "sessionID": "ses_f0ddba907ffeHoSABAb2zhuSrx",
      "assistantMessageID": "msg_0f224d72f001fI8DzJWxhAWqYl",
      "ordinal": 0,
      "text": "\nThe command ran successfully and output \"probe-ok\". Now I need to reply with one short sentence as requested.",
      "state": {
        "reasoningField": "reasoning_content"
      }
    }
  },
  {
    "created": 1790768898887,
    "type": "session.text.ended",
    "data": {
      "sessionID": "ses_f0ddba907ffeHoSABAb2zhuSrx",
      "assistantMessageID": "msg_0f224d72f001fI8DzJWxhAWqYl",
      "ordinal": 0,
      "text": "The shell command executed successfully and printed `probe-ok`."
    }
  },
  {
    "created": 1790768898890,
    "type": "session.step.ended",
    "data": {
      "sessionID": "ses_f0ddba907ffeHoSABAb2zhuSrx",
      "assistantMessageID": "msg_0f224d72f001fI8DzJWxhAWqYl",
      "finish": "stop",
      "rawFinish": "stop",
      "cost": 0,
      "tokens": {
        "input": 3094,
        "output": 15,
        "reasoning": 24,
        "cache": {
          "read": 5632,
          "write": 0
        }
      }
    }
  },
  {
    "created": 1790768898892,
    "type": "session.usage.updated",
    "data": {
      "sessionID": "ses_f0ddba907ffeHoSABAb2zhuSrx",
      "cost": 0,
      "tokens": {
        "input": 6122,
        "output": 34,
        "reasoning": 56,
        "cache": {
          "read": 11264,
          "write": 0
        }
      }
    }
  },
  {
    "created": 1790768898893,
    "type": "session.execution.succeeded",
    "data": {
      "sessionID": "ses_f0ddba907ffeHoSABAb2zhuSrx"
    }
  }
];

/** A permission ask and its reply (from the same probe session). */
export const PERMISSION_EVENTS: ReadonlyArray<Record<string, unknown>> = [
  {
    "created": 1790768871289,
    "type": "permission.asked",
    "data": {
      "id": "per_0f2247778001tngDfYafZ62Aag",
      "sessionID": "ses_f0ddba907ffeHoSABAb2zhuSrx",
      "action": "shell",
      "resources": [
        "echo probe-ok"
      ],
      "save": [
        "echo *"
      ],
      "source": {
        "type": "tool",
        "messageID": "msg_0f22468710012E153TICA4JL4d",
        "id": "call_b89aee2d3ba0488fa39560cd"
      }
    }
  },
  {
    "created": 1790768895778,
    "type": "permission.replied",
    "data": {
      "sessionID": "ses_f0ddba907ffeHoSABAb2zhuSrx",
      "requestID": "per_0f2247778001tngDfYafZ62Aag",
      "reply": "once"
    }
  },
  {
    "created": 1790769183142,
    "type": "permission.asked",
    "data": {
      "id": "per_0f22939a5001SN2lP66QS5fFwa",
      "sessionID": "ses_f0ddba907ffeHoSABAb2zhuSrx",
      "action": "shell",
      "resources": [
        "echo second"
      ],
      "save": [
        "echo *"
      ],
      "source": {
        "type": "tool",
        "messageID": "msg_0f2291cb9001zbZ0jwxVCmuYwW",
        "id": "call_fb6ddc6b1d774052a7383943"
      }
    }
  },
  {
    "created": 1790769183894,
    "type": "permission.replied",
    "data": {
      "sessionID": "ses_f0ddba907ffeHoSABAb2zhuSrx",
      "requestID": "per_0f22939a5001SN2lP66QS5fFwa",
      "reply": "reject"
    }
  }
];

/** A question form the model opened, and its reply. */
export const QUESTION_EVENTS: ReadonlyArray<Record<string, unknown>> = [
  {
    "created": 1790768959736,
    "type": "form.created",
    "data": {
      "form": {
        "id": "frm_0f225d0f8001PFnM3IuuA7iufm",
        "sessionID": "ses_f0ddba907ffeHoSABAb2zhuSrx",
        "title": "Questions",
        "metadata": {
          "kind": "question",
          "tool": {
            "messageID": "msg_0f225bc0f001UgIyugxygJ4fJT",
            "id": "call_d725156e90da4207a5c400f7"
          }
        },
        "fields": [
          {
            "key": "q0",
            "title": "Color",
            "description": "Which color do you prefer?",
            "type": "string",
            "options": [
              {
                "value": "Red",
                "label": "Red",
                "description": "The color red"
              },
              {
                "value": "Blue",
                "label": "Blue",
                "description": "The color blue"
              }
            ],
            "custom": true
          }
        ]
      }
    }
  },
  {
    "created": 1790769024343,
    "type": "form.replied",
    "data": {
      "id": "frm_0f225d0f8001PFnM3IuuA7iufm",
      "sessionID": "ses_f0ddba907ffeHoSABAb2zhuSrx",
      "answer": {
        "q0": "Red"
      }
    }
  },
  {
    "created": 1790769208575,
    "type": "form.created",
    "data": {
      "form": {
        "id": "frm_0f2299cff001qGkS74DhKP4abY",
        "sessionID": "ses_f0ddba907ffeHoSABAb2zhuSrx",
        "title": "Questions",
        "metadata": {
          "kind": "question",
          "tool": {
            "messageID": "msg_0f2298f46001fd6mx3nwk7zIDb",
            "id": "call_f52061dc7ee2491fb1e4846e"
          }
        },
        "fields": [
          {
            "key": "q0",
            "title": "",
            "description": "Do you prefer cats or dogs?",
            "type": "string",
            "options": [
              {
                "value": "",
                "label": "",
                "description": ""
              },
              {
                "value": "",
                "label": "",
                "description": ""
              }
            ],
            "custom": true
          }
        ]
      }
    }
  }
];

/** A turn whose question form is cancelled while a steer is queued: the first execution is interrupted, a second one runs the steer. */
export const STEER_AND_CANCEL_EVENTS: ReadonlyArray<Record<string, unknown>> = [
  {
    "created": 1790769205056,
    "type": "session.inbox.enqueued",
    "data": {
      "inboxID": "msg_0f2298f40001GoS4qYO74LlSoU",
      "sessionID": "ses_f0ddba907ffeHoSABAb2zhuSrx",
      "item": {
        "type": "user",
        "payload": {
          "text": "Use your question tool to ask me whether I prefer cats or dogs. Do not answer yourself."
        },
        "delivery": "steer"
      }
    }
  },
  {
    "created": 1790769205057,
    "type": "session.execution.started",
    "data": {
      "sessionID": "ses_f0ddba907ffeHoSABAb2zhuSrx"
    }
  },
  {
    "created": 1790769205060,
    "type": "session.inbox.delivered",
    "data": {
      "sessionID": "ses_f0ddba907ffeHoSABAb2zhuSrx",
      "inboxID": "msg_0f2298f40001GoS4qYO74LlSoU"
    }
  },
  {
    "created": 1790769206855,
    "type": "session.step.started",
    "data": {
      "sessionID": "ses_f0ddba907ffeHoSABAb2zhuSrx",
      "agent": "build",
      "model": {
        "id": "longcat-2.5-preview-free",
        "providerID": "opencode",
        "variant": "default"
      },
      "assistantMessageID": "msg_0f2298f46001fd6mx3nwk7zIDb",
      "started": 1790769205066
    }
  },
  {
    "created": 1790769206856,
    "type": "session.reasoning.started",
    "data": {
      "sessionID": "ses_f0ddba907ffeHoSABAb2zhuSrx",
      "assistantMessageID": "msg_0f2298f46001fd6mx3nwk7zIDb",
      "ordinal": 0,
      "state": {
        "reasoningField": "reasoning_content"
      }
    }
  },
  {
    "created": 1790769206958,
    "type": "session.reasoning.delta",
    "data": {
      "sessionID": "ses_f0ddba907ffeHoSABAb2zhuSrx",
      "assistantMessageID": "msg_0f2298f46001fd6mx3nwk7zIDb",
      "ordinal": 0,
      "delta": "\n"
    }
  },
  {
    "created": 1790769207754,
    "type": "session.tool.input.started",
    "data": {
      "sessionID": "ses_f0ddba907ffeHoSABAb2zhuSrx",
      "assistantMessageID": "msg_0f2298f46001fd6mx3nwk7zIDb",
      "id": "call_f52061dc7ee2491fb1e4846e",
      "name": "question"
    }
  },
  {
    "created": 1790769208567,
    "type": "session.reasoning.ended",
    "data": {
      "sessionID": "ses_f0ddba907ffeHoSABAb2zhuSrx",
      "assistantMessageID": "msg_0f2298f46001fd6mx3nwk7zIDb",
      "ordinal": 0,
      "text": "\nThe user wants me to use the question tool to ask them whether they prefer cats or dogs. I should not answer it myself. I'll use the question tool with the appropriate parameters.",
      "state": {
        "reasoningField": "reasoning_content"
      }
    }
  },
  {
    "created": 1790769208570,
    "type": "session.tool.input.ended",
    "data": {
      "sessionID": "ses_f0ddba907ffeHoSABAb2zhuSrx",
      "assistantMessageID": "msg_0f2298f46001fd6mx3nwk7zIDb",
      "id": "call_f52061dc7ee2491fb1e4846e",
      "text": "{\"questions\": [{\"question\": \"Do you prefer cats or dogs?\", \"header\": \"\", \"options\": [{\"label\": \"\", \"description\": \"\"}, {\"label\": \"\", \"description\": \"\"}], \"multiple\": false}]}"
    }
  },
  {
    "created": 1790769208571,
    "type": "session.tool.called",
    "data": {
      "sessionID": "ses_f0ddba907ffeHoSABAb2zhuSrx",
      "assistantMessageID": "msg_0f2298f46001fd6mx3nwk7zIDb",
      "id": "call_f52061dc7ee2491fb1e4846e",
      "input": {
        "questions": [
          {
            "question": "Do you prefer cats or dogs?",
            "header": "",
            "options": [
              {
                "label": "",
                "description": ""
              },
              {
                "label": "",
                "description": ""
              }
            ],
            "multiple": false
          }
        ]
      },
      "executed": false
    }
  },
  {
    "created": 1790769208575,
    "type": "form.created",
    "data": {
      "form": {
        "id": "frm_0f2299cff001qGkS74DhKP4abY",
        "sessionID": "ses_f0ddba907ffeHoSABAb2zhuSrx",
        "title": "Questions",
        "metadata": {
          "kind": "question",
          "tool": {
            "messageID": "msg_0f2298f46001fd6mx3nwk7zIDb",
            "id": "call_f52061dc7ee2491fb1e4846e"
          }
        },
        "fields": [
          {
            "key": "q0",
            "title": "",
            "description": "Do you prefer cats or dogs?",
            "type": "string",
            "options": [
              {
                "value": "",
                "label": "",
                "description": ""
              },
              {
                "value": "",
                "label": "",
                "description": ""
              }
            ],
            "custom": true
          }
        ]
      }
    }
  },
  {
    "created": 1790769209125,
    "type": "session.inbox.enqueued",
    "data": {
      "inboxID": "msg_0f2299f250011MTk269ZctW4n0",
      "sessionID": "ses_f0ddba907ffeHoSABAb2zhuSrx",
      "item": {
        "type": "user",
        "payload": {
          "text": "Actually also say the word KIWI at the end."
        },
        "delivery": "steer"
      }
    }
  },
  {
    "created": 1790769209168,
    "type": "form.cancelled",
    "data": {
      "id": "frm_0f2299cff001qGkS74DhKP4abY",
      "sessionID": "ses_f0ddba907ffeHoSABAb2zhuSrx"
    }
  },
  {
    "created": 1790769209168,
    "type": "session.tool.failed",
    "data": {
      "sessionID": "ses_f0ddba907ffeHoSABAb2zhuSrx",
      "assistantMessageID": "msg_0f2298f46001fd6mx3nwk7zIDb",
      "id": "call_f52061dc7ee2491fb1e4846e",
      "error": {
        "type": "aborted",
        "message": "The user dismissed this question"
      },
      "executed": false
    }
  },
  {
    "created": 1790769209169,
    "type": "session.step.failed",
    "data": {
      "sessionID": "ses_f0ddba907ffeHoSABAb2zhuSrx",
      "assistantMessageID": "msg_0f2298f46001fd6mx3nwk7zIDb",
      "error": {
        "type": "aborted",
        "message": "Step interrupted"
      },
      "rawFinish": "tool_calls",
      "cost": 0,
      "tokens": {
        "input": 155,
        "output": 56,
        "reasoning": 38,
        "cache": {
          "read": 8960,
          "write": 0
        }
      }
    }
  },
  {
    "created": 1790769209170,
    "type": "session.usage.updated",
    "data": {
      "sessionID": "ses_f0ddba907ffeHoSABAb2zhuSrx",
      "cost": 0,
      "tokens": {
        "input": 11079,
        "output": 363,
        "reasoning": 407,
        "cache": {
          "read": 60928,
          "write": 0
        }
      }
    }
  },
  {
    "created": 1790769209170,
    "type": "session.execution.interrupted",
    "data": {
      "sessionID": "ses_f0ddba907ffeHoSABAb2zhuSrx",
      "reason": "shutdown"
    }
  },
  {
    "created": 1790769209171,
    "type": "session.execution.started",
    "data": {
      "sessionID": "ses_f0ddba907ffeHoSABAb2zhuSrx"
    }
  },
  {
    "created": 1790769209174,
    "type": "session.inbox.delivered",
    "data": {
      "sessionID": "ses_f0ddba907ffeHoSABAb2zhuSrx",
      "inboxID": "msg_0f2299f250011MTk269ZctW4n0"
    }
  },
  {
    "created": 1790769210911,
    "type": "session.step.started",
    "data": {
      "sessionID": "ses_f0ddba907ffeHoSABAb2zhuSrx",
      "agent": "build",
      "model": {
        "id": "longcat-2.5-preview-free",
        "providerID": "opencode",
        "variant": "default"
      },
      "assistantMessageID": "msg_0f2299f57001jpZmOqnT1WIU3A",
      "started": 1790769209178
    }
  },
  {
    "created": 1790769210914,
    "type": "session.reasoning.started",
    "data": {
      "sessionID": "ses_f0ddba907ffeHoSABAb2zhuSrx",
      "assistantMessageID": "msg_0f2299f57001jpZmOqnT1WIU3A",
      "ordinal": 0,
      "state": {
        "reasoningField": "reasoning_content"
      }
    }
  },
  {
    "created": 1790769211724,
    "type": "session.text.started",
    "data": {
      "sessionID": "ses_f0ddba907ffeHoSABAb2zhuSrx",
      "assistantMessageID": "msg_0f2299f57001jpZmOqnT1WIU3A",
      "ordinal": 0
    }
  },
  {
    "created": 1790769211806,
    "type": "session.reasoning.ended",
    "data": {
      "sessionID": "ses_f0ddba907ffeHoSABAb2zhuSrx",
      "assistantMessageID": "msg_0f2299f57001jpZmOqnT1WIU3A",
      "ordinal": 0,
      "text": "\nThe user wants me to say the word KIWI at the end of my response. This is a simple text request - no tools needed. I'll just include it in my reply.",
      "state": {
        "reasoningField": "reasoning_content"
      }
    }
  },
  {
    "created": 1790769211809,
    "type": "session.text.delta",
    "data": {
      "sessionID": "ses_f0ddba907ffeHoSABAb2zhuSrx",
      "assistantMessageID": "msg_0f2299f57001jpZmOqnT1WIU3A",
      "ordinal": 0,
      "delta": "KIWI"
    }
  },
  {
    "created": 1790769211809,
    "type": "session.text.ended",
    "data": {
      "sessionID": "ses_f0ddba907ffeHoSABAb2zhuSrx",
      "assistantMessageID": "msg_0f2299f57001jpZmOqnT1WIU3A",
      "ordinal": 0,
      "text": "KIWI"
    }
  },
  {
    "created": 1790769211812,
    "type": "session.step.ended",
    "data": {
      "sessionID": "ses_f0ddba907ffeHoSABAb2zhuSrx",
      "assistantMessageID": "msg_0f2299f57001jpZmOqnT1WIU3A",
      "finish": "stop",
      "rawFinish": "stop",
      "cost": 0,
      "tokens": {
        "input": 169,
        "output": 5,
        "reasoning": 39,
        "cache": {
          "read": 9088,
          "write": 0
        }
      }
    }
  },
  {
    "created": 1790769211813,
    "type": "session.usage.updated",
    "data": {
      "sessionID": "ses_f0ddba907ffeHoSABAb2zhuSrx",
      "cost": 0,
      "tokens": {
        "input": 11248,
        "output": 368,
        "reasoning": 446,
        "cache": {
          "read": 70016,
          "write": 0
        }
      }
    }
  },
  {
    "created": 1790769211814,
    "type": "session.execution.succeeded",
    "data": {
      "sessionID": "ses_f0ddba907ffeHoSABAb2zhuSrx"
    }
  }
];

/** A run that fails before any step: `provider.no-route`. */
export const EXECUTION_FAILED_EVENTS: ReadonlyArray<Record<string, unknown>> = [
  {
    "created": 1790769059706,
    "type": "session.agent.selected",
    "data": {
      "sessionID": "ses_f0ddba907ffeHoSABAb2zhuSrx",
      "agent": "build",
      "previous": "nope"
    }
  },
  {
    "created": 1790769059722,
    "type": "session.inbox.enqueued",
    "data": {
      "inboxID": "msg_0f227578a001zzQYgXTzPAaubo",
      "sessionID": "ses_f0ddba907ffeHoSABAb2zhuSrx",
      "item": {
        "type": "user",
        "payload": {
          "text": "hi"
        },
        "delivery": "steer"
      }
    }
  },
  {
    "created": 1790769059723,
    "type": "session.execution.started",
    "data": {
      "sessionID": "ses_f0ddba907ffeHoSABAb2zhuSrx"
    }
  },
  {
    "created": 1790769059729,
    "type": "session.inbox.delivered",
    "data": {
      "sessionID": "ses_f0ddba907ffeHoSABAb2zhuSrx",
      "inboxID": "msg_0f2273d22001FH4WK2r6HkzA2I"
    }
  },
  {
    "created": 1790769059729,
    "type": "session.inbox.delivered",
    "data": {
      "sessionID": "ses_f0ddba907ffeHoSABAb2zhuSrx",
      "inboxID": "msg_0f2273d33001l7MpbLZwDFLdcb"
    }
  },
  {
    "created": 1790769059730,
    "type": "session.inbox.delivered",
    "data": {
      "sessionID": "ses_f0ddba907ffeHoSABAb2zhuSrx",
      "inboxID": "msg_0f227578a001zzQYgXTzPAaubo"
    }
  },
  {
    "created": 1790769059731,
    "type": "session.execution.failed",
    "data": {
      "sessionID": "ses_f0ddba907ffeHoSABAb2zhuSrx",
      "error": {
        "type": "provider.no-route",
        "message": "Model unavailable: opencode/nope"
      }
    }
  }
];

/** A tool that failed to execute. */
export const TOOL_FAILED_EVENTS: ReadonlyArray<Record<string, unknown>> = [
  {
    "created": 1790769183895,
    "type": "session.tool.failed",
    "data": {
      "sessionID": "ses_f0ddba907ffeHoSABAb2zhuSrx",
      "assistantMessageID": "msg_0f2291cb9001zbZ0jwxVCmuYwW",
      "id": "call_fb6ddc6b1d774052a7383943",
      "error": {
        "type": "tool.execution",
        "message": "Unable to execute command: echo second"
      },
      "executed": false
    }
  },
  {
    "created": 1790769209168,
    "type": "session.tool.failed",
    "data": {
      "sessionID": "ses_f0ddba907ffeHoSABAb2zhuSrx",
      "assistantMessageID": "msg_0f2298f46001fd6mx3nwk7zIDb",
      "id": "call_f52061dc7ee2491fb1e4846e",
      "error": {
        "type": "aborted",
        "message": "The user dismissed this question"
      },
      "executed": false
    }
  }
];

/** `message.list` for the shell turn: user, two assistant steps, idle. */
export const TIMELINE_ITEMS: ReadonlyArray<Record<string, unknown>> = [
  {
    "id": "msg_6f89c3f0317c3TtJp3TRZuOMpO",
    "time": {
      "created": 1790768867437
    },
    "text": "Use the shell tool to run exactly: echo probe-ok. Then reply with one short sentence.",
    "type": "user"
  },
  {
    "id": "msg_0f22468710012E153TICA4JL4d",
    "time": {
      "created": 1790768867474,
      "streamed": 1790768871271,
      "completed": 1790768895785
    },
    "type": "assistant",
    "agent": "build",
    "model": {
      "id": "longcat-2.5-preview-free",
      "providerID": "opencode"
    },
    "content": [
      {
        "type": "reasoning",
        "text": "\nThe user wants me to run a simple shell command and then reply with one short sentence. This is straightforward - no need for skills or complex tooling.",
        "state": {
          "reasoningField": "reasoning_content"
        },
        "time": {
          "created": 1790768869764,
          "completed": 1790768871266
        }
      },
      {
        "type": "tool",
        "id": "call_b89aee2d3ba0488fa39560cd",
        "name": "shell",
        "executed": false,
        "state": {
          "status": "completed",
          "input": {
            "command": "echo probe-ok"
          },
          "content": [
            {
              "type": "text",
              "text": "probe-ok\n"
            }
          ],
          "metadata": {
            "status": "completed",
            "truncated": false,
            "exit": 0
          }
        },
        "time": {
          "created": 1790768870633,
          "ran": 1790768871270,
          "completed": 1790768895784
        }
      }
    ],
    "finish": "tool-calls",
    "rawFinish": "tool_calls",
    "cost": 0,
    "tokens": {
      "input": 3028,
      "output": 19,
      "reasoning": 32,
      "cache": {
        "read": 5632,
        "write": 0
      }
    }
  },
  {
    "id": "msg_0f224d72f001fI8DzJWxhAWqYl",
    "time": {
      "created": 1790768895795,
      "streamed": 1790768898889,
      "completed": 1790768898890
    },
    "type": "assistant",
    "agent": "build",
    "model": {
      "id": "longcat-2.5-preview-free",
      "providerID": "opencode"
    },
    "content": [
      {
        "type": "reasoning",
        "text": "\nThe command ran successfully and output \"probe-ok\". Now I need to reply with one short sentence as requested.",
        "state": {
          "reasoningField": "reasoning_content"
        },
        "time": {
          "created": 1790768898171,
          "completed": 1790768898885
        }
      },
      {
        "type": "text",
        "text": "The shell command executed successfully and printed `probe-ok`."
      }
    ],
    "finish": "stop",
    "rawFinish": "stop",
    "cost": 0,
    "tokens": {
      "input": 3094,
      "output": 15,
      "reasoning": 24,
      "cache": {
        "read": 5632,
        "write": 0
      }
    }
  },
  {
    "id": "msg_0f224e34d001WR6BQS9GB2R7IV",
    "time": {
      "created": 1790768898893
    },
    "type": "idle",
    "outcome": "succeeded"
  }
];

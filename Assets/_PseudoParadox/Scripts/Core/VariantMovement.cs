using System.Collections.Generic;
using UnityEngine;

public class VariantMovement : MonoBehaviour
{

    public CharacterController controller;
    public Animator animator;
    public float speed = 6f;
    public Clock clock;
    public PlayerPositionManager playerPositionManager;
    public int instanceNumber;

    void Update()
    {
        /*        float targetAngle = 90;
                Vector3 moveDir = Quaternion.Euler(0f, targetAngle, 0f) * Vector3.forward;
                controller.Move(moveDir.normalized * speed * Time.deltaTime);

                animator.SetFloat("Forward", (moveDir.magnitude));*/

        Dictionary<string, Vector3> previousTimeToPositionDict = playerPositionManager.timeMachine[instanceNumber - 1];
        string key = clock.clockText.text;
        if (previousTimeToPositionDict.ContainsKey(key))
        {
            transform.position = previousTimeToPositionDict[key];
        } else
        {
            Destroy(gameObject);
        }
    }
}

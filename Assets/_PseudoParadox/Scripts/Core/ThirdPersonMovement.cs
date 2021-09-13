using UnityEngine;

public class ThirdPersonMovement : MonoBehaviour
{

    public CharacterController controller;
    public Transform cam;
    public Animator animator;
    public Clock clock;
    public PlayerPositionManager playerPositionManager;

    public float speed = 6f;

    public float turnSmoothTime = 0.1f;
    float turnSmoothVelocity;

    void Update()
    {
        playerPositionManager.StorePosition(transform.position, clock.clockText.text);
        MoveCharacter();
    }

    private void MoveCharacter()
    {
        if (!playerPositionManager.shouldResetPosition)
        {
            float horizontal = Input.GetAxisRaw("Horizontal");
            float vertical = Input.GetAxisRaw("Vertical");
            Vector3 direction = new Vector3(horizontal, 0f, vertical).normalized;

            if (direction.magnitude >= 0.1f)
            {
                float targetAngle = Mathf.Atan2(direction.x, direction.z) * Mathf.Rad2Deg + cam.eulerAngles.y;
                float angle = Mathf.SmoothDampAngle(transform.eulerAngles.y, targetAngle, ref turnSmoothVelocity, turnSmoothTime);
                transform.rotation = Quaternion.Euler(0f, angle, 0f);

                Vector3 moveDir = Quaternion.Euler(0f, targetAngle, 0f) * Vector3.forward;
                controller.Move(moveDir.normalized * speed * Time.deltaTime);

                animator.SetFloat("Forward", (moveDir.magnitude));
            }
            else
            {
                animator.SetFloat("Forward", 0.0f);
            }
        }
        else
        {
            playerPositionManager.shouldResetPosition = false;
            transform.position = playerPositionManager.startingPosition;
        }
    }
}
